/*                      
======================================================================================================
ARSET Training: NASA Earth Observations for Reservoir and Water Utility Management
Date: 6 July 2026
Demonstration: Comprehensive Hydrology for the Lake Powell Watershed 
Datasets: GLDAS (SWE & Runoff), MODIS (Snow Cover), GPM IMERG (Precipitation), SMAP L3 (Soil Moisture)
Authors: Amita Mehta, Sean McCartney 
------------------------------------------------------------------------------------------------------
Script Description: 
This script uses the Lake Powell watershed as a case study to demonstrate how to:
  1. Define a watershed boundary using the HydroBASINS dataset.
  2. Access multi-sensor data representing the full hydrological cycle:
     - Snow Water Equivalent & Runoff (GLDAS)
     - Snow Cover Percentage (MODIS)
     - Precipitation (GPM IMERG)
     - Surface Soil Moisture (SMAP Level 3)
  3. Generate a 10-year (2016-2025) monthly mean climatology to observe long-term seasonal trends.
  4. Perform mathematical unit conversions to standardize hydrological outputs.
  5. Map the seasonal variations of all variables from January to December.
------------------------------------------------------------------------------------------------------
Terms of Use:
This code is free and open. By using this code you agree to cite the following reference:
NASA Applied Remote Sensing Training (ARSET) program.
======================================================================================================
*/

// ===================================================================================
// STEP 1: Define the Region of Interest (ROI) - Lake Powell Watershed
// ===================================================================================
/* 
   GEE CONCEPT: FeatureCollections are used to load vector data (polygons, lines, points).
   HydroBASINS provides watershed boundaries at various Pfafstetter scale levels.
   We use Level 3 to capture the large regional Colorado River Basin that feeds Lake Powell.
*/
var basins = ee.FeatureCollection('WWF/HydroSHEDS/v1/Basins/hybas_3');
var Colorado = basins.filter(ee.Filter.eq('HYBAS_ID', 7030008710)); 

// Center the map on Lake Powell and set the basemap to 'TERRAIN'.
// Topography is a major driver of snowpack accumulation and runoff routing.
Map.setCenter(-110, 37, 5);
Map.setOptions('TERRAIN'); 

// Create a hollow styling for the basin boundary so we can see the data underneath
var Cbasin = Colorado.style({
  color: 'gray',         
  fillColor: '00000000', // 00 opacity makes the fill transparent
  width: 2               
});
Map.addLayer(Cbasin, {}, 'Selected Basin: Lake Powell Watershed');


// ===================================================================================
// STEP 2: Access and Filter Multi-Sensor Data (10-Year Study Period)
// ===================================================================================
/*
   GEE CONCEPT: We apply `.filterBounds()` immediately when loading ImageCollections.
   This prevents Earth Engine from processing global data, saving massive amounts of memory.
*/
var startDate = '2016-01-01';
var endDate   = '2026-01-01';

// Dataset 1: GLDAS version 2.2 (Daily SWE & Runoff at 0.25 degree resolution)
var gldasDataset = ee.ImageCollection('NASA/GLDAS/V022/CLSM/G025/DA1D')
                     .filterDate(startDate, endDate) 
                     .filterBounds(Colorado)         
                     .select(['SWE_tavg', 'Qs_tavg', 'Qsb_tavg']); 

// Dataset 2: MODIS Terra Snow Cover Daily L3 (500m resolution)
var snowCover = ee.ImageCollection('MODIS/061/MOD10A1')
                  .filterDate(startDate, endDate)
                  .filterBounds(Colorado)
                  .select('NDSI_Snow_Cover')
                  .map(function(img) {
                    // Data Quality Filter: Values > 100 represent clouds or water.
                    // We update the mask to isolate only valid snow pixels (0-100%).
                    return img.updateMask(img.lte(100));
                  });

// Dataset 3: GPM IMERG Monthly Level 3 Version 7 (~11 km resolution)
var imergDataset = ee.ImageCollection('NASA/GPM_L3/IMERG_MONTHLY_V07')
                     .filterDate(startDate, endDate)
                     .filterBounds(Colorado)
                     .select('precipitation');

// Dataset 4: SMAP Level 3 Enhanced (Daily Surface Soil Moisture at 9 km resolution)
/* 
   DATASET NOTE: This script uses SMAP Version 5 ('SPL3SMP_E/005'). 
   Data starting from Dec 4, 2023, are available in the newer 'SPL3SMP_E/006' collection.
   Because our end date is 2026, the SMAP mean will utilize data from 2016 to late 2023,
   while GLDAS, MODIS, and IMERG will use the full 2016-2025 range. 
   
   We select 'soil_moisture_am' (~6:00 AM overpass) as soil and vegetation are 
   typically in thermal equilibrium in the morning, yielding more accurate retrievals.
*/
var smapDataset = ee.ImageCollection('NASA/SMAP/SPL3SMP_E/005')
                    .filterDate(startDate, endDate)
                    .filterBounds(Colorado)
                    .select('soil_moisture_am');


// ===================================================================================
// STEP 3: Calculate the 10-Year Monthly Mean Climatology
// ===================================================================================
/*
   GEE CONCEPT: In Earth Engine, we avoid standard 'for' loops for heavy processing. 
   Instead, we create a list of months (1-12) and use `.map()` to apply our averaging 
   function across the server in parallel.
*/
var months = ee.List.sequence(1, 12);

var monthlyClimatology = ee.ImageCollection.fromImages(
  months.map(function(m) {
    
    // -- GLDAS Processing (State & Rate Variables) --
    var gldasMonth = gldasDataset.filter(ee.Filter.calendarRange(m, m, 'month')).mean(); 

    // -- MODIS Processing (State Variable) --
    var snowMonth = snowCover.filter(ee.Filter.calendarRange(m, m, 'month')).mean(); 

    // -- IMERG Processing (Rate Variable) --
    /* 
       HYDROLOGY CONCEPT: IMERG provides a precipitation RATE (mm/hr). 
       We multiply the hourly average by 24 to get the average daily accumulation (mm/day).
    */
    var precipMonth = imergDataset.filter(ee.Filter.calendarRange(m, m, 'month'))
                                  .mean().multiply(24).rename('precipitation_daily');

    // -- SMAP Processing (State Variable) --
    // Volumetric soil moisture (m^3/m^3) requires no conversion.
    var smapMonth = smapDataset.filter(ee.Filter.calendarRange(m, m, 'month')).mean();

    // Combine all sensor bands into a single composite image for this specific month
    var combinedMonthly = gldasMonth.addBands(snowMonth)
                                    .addBands(precipMonth)
                                    .addBands(smapMonth);

    // Set the metadata properties so GEE knows which month this image represents
    return combinedMonthly
      .set('month', m)
      .set('system:time_start', ee.Date.fromYMD(2016, m, 1).millis());
  })
);


// ===================================================================================
// STEP 4: Process Watershed Data, Unit Conversions, & Total Runoff
// ===================================================================================
/*
   GEE CONCEPT: We wait to clip the data until the very end. Clipping 12 monthly 
   averages is much faster than clipping thousands of daily raw images in Step 2.
*/
var Param_watershed = monthlyClimatology.map(function(img) {
  var clippedImg = img.clip(Colorado);

  /* 
     HYDROLOGY CONCEPT: GLDAS runoff is natively provided as a rate (kg/m^2/s).
     Because 1 kg of water spread over 1 square meter equals 1 millimeter in depth,
     we multiply by 86,400 (seconds in a day) to convert this to mm/day.
  */
  var runoffDaily = clippedImg.select('Qs_tavg').multiply(86400);
  var srunoffDaily = clippedImg.select('Qsb_tavg').multiply(86400);

  // Add surface runoff and sub-surface baseflow to get Total Runoff
  var trunoffDaily = runoffDaily.add(srunoffDaily).rename('Total_Runoff_daily');
  
  // Overwrite the original bands with our newly calculated daily rate bands
  return clippedImg
        .addBands(runoffDaily, null, true)  
        .addBands(srunoffDaily, null, true) 
        .addBands(trunoffDaily);            
});

print('10-Year Monthly Climatology (All Variables):');
print(Param_watershed);

// ===================================================================================
// STEP 5: Map Visualization (Looping through 12 months)
// ===================================================================================
// Define visualization color palettes and minimum/maximum data ranges
var visParamsPrecip = {min: 0, max: 10, palette: ['white', 'blue', 'cyan', 'green', 'yellow', 'red']}; 
var visParamsSM = {min: 0, max: 0.5, palette: ['8B4513', 'FFD700', '00FF00', '0000FF']}; // Brown (dry) to Blue (wet)
var visParamsSnow = {min: 0, max: 100, palette: ['black', 'cyan', 'blue', 'white']}; // 0 to 100% cover
var visParamsSWE = {min: 0, max: 20, palette: ['blue', 'green', 'yellow', 'orange', 'red']}; 
var visParamsRunoff = {min: 0, max: 0.08, palette: ['blue', 'green', 'yellow', 'orange', 'red']}; 

// Loop through months 1 to 12 to add them as individual map layers in the interface
for (var i = 1; i <= 12; i++) {
  var monthImg = Param_watershed.filter(ee.Filter.eq('month', i)).first();

  /* 
    MEMORY MANAGEMENT: The visibility flag is set to 'false' for all layers. 
    This adds the layers to the map interface without actively rendering all 60 of them 
    simultaneously, which prevents browser crashes. One can manually check the 
    boxes in the "Layers" tab to toggle specific months on and off.
  */

  Map.addLayer(
    monthImg.select('precipitation_daily'), 
    visParamsPrecip, 
    'Month ' + i + ' - Mean Daily Precip', 
    false
  );

  Map.addLayer(
    monthImg.select('soil_moisture_am'), 
    visParamsSM, 
    'Month ' + i + ' - Mean Surface SM (AM)', 
    false
  );

  Map.addLayer(
    monthImg.select('NDSI_Snow_Cover'), 
    visParamsSnow, 
    'Month ' + i + ' - Mean Snow Cover (%)', 
    false
  );

  Map.addLayer(
    monthImg.select('SWE_tavg'), 
    visParamsSWE, 
    'Month ' + i + ' - Mean SWE', 
    false
  );

  Map.addLayer(
    monthImg.select('Total_Runoff_daily'), 
    visParamsRunoff, 
    'Month ' + i + ' - Total Mean Runoff', 
    false
  );
}


// ===================================================================================
// STEP 6: Overlay Reference Map Data (Lakes via GLOBathy)
// ===================================================================================
// To provide geographic context, we overlay global lake bathymetry data (HydroLAKES).
// This helps participants visually locate Lake Powell and surrounding water bodies.
var globathy = ee.Image("projects/sat-io/open-datasets/GLOBathy/GLOBathy_bathymetry");
var basinLakes = globathy.clip(Colorado);
Map.addLayer(basinLakes, {palette: ['white']}, "Water Bodies (Lakes)");

// ===================================================================================
// End of Script
// ===================================================================================
