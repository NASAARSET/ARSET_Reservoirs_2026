/*                      
======================================================================================================
ARSET Training: NASA Earth Observations for Reservoir and Water Utility Management
Date: 6 August 2026
Training Website: https://www.earthdata.nasa.gov/learn/trainings/nasa-earth-observations-reservoir-water-utility-management
Demonstration: Comprehensive Hydrology for the Lake Powell Watershed 
Datasets: GLDAS (SWE & Runoff), MODIS (Snow Cover), GPM IMERG (Precipitation), SMAP L3 (Soil Moisture)
Authors: Amita Mehta, Sean McCartney
------------------------------------------------------------------------------------------------------
Script Description: 
This script uses the Lake Powell watershed as a case study to demonstrate how to:
  1. Define a watershed boundary (HydroBASINS) and load reference water bodies (GLOBathy).
  2. Access multi-sensor data representing the full hydrological cycle:
     - Snow Water Equivalent & Runoff (GLDAS)
     - Snow Cover Percentage (MODIS)
     - Precipitation (GPM IMERG)
     - Surface Soil Moisture (SMAP Level 3)
  3. Generate a 5-year (2021-2026) monthly mean climatology to observe seasonal trends.
  4. Perform mathematical unit conversions to standardize hydrological outputs.
  5. Map the seasonal variations of all variables from January to December.
  6. Generate dynamic legends for map interpretation.
------------------------------------------------------------------------------------------------------
Terms of Use:
This code is free and open. By using this code you agree to cite the following reference:
NASA Applied Remote Sensing Training (ARSET) program.
======================================================================================================

=======================================================================================================
                                               DISCLAIMER
Every effort is made to ensure the code is free of errors, but there is no warranty that the maps 
and their features are either spatially or temporally accurate or fit for a particular use. 
This code is provided without any warranty of any kind whatsoever, either express or implied.
=======================================================================================================   
*/

// ===================================================================================
// STEP 1: Define the Region of Interest (ROI) & Reference Map Data
// ===================================================================================
/*
   GEE CONCEPT: FeatureCollections load vector data (polygons, lines, points).
   HydroBASINS provides watershed boundaries at various Pfafstetter scale levels.
   We use Level 3 to capture the large regional Colorado River Basin that feeds Lake Powell.
   
   PRO-TIP: HOW TO FIND OTHER BASINS
   1. Turn on the 'HydroSHEDS' layer via the Layers menu (top right of the map).
   2. Click the 'Inspector' tab in the top-right console.
   3. Click any watershed polygon on the map. 
   4. Expand the feature's properties in the Inspector to find its unique 'HYBAS_ID'.
*/

var basins = ee.FeatureCollection('WWF/HydroSHEDS/v1/Basins/hybas_3');
var Colorado = basins.filter(ee.Filter.eq('HYBAS_ID', 7030008710)); 

// Center the map on Lake Powell and set the basemap to 'TERRAIN'.
// Topography is a major driver of snowpack accumulation and runoff routing.
Map.setCenter(-110, 37, 5);
Map.setOptions('TERRAIN'); 

// Create a hollow styling for the basin boundary to ensure underlying data remains visible.
var Cbasin = Colorado.style({
  color: 'gray',         
  fillColor: '00000000', // '00' opacity makes the fill transparent
  width: 2               
});

// Add the full HydroSHEDS layer (hidden by default) and the specific Colorado Basin boundary.
Map.addLayer(basins, {}, 'HydroSHEDS (Global)', false); 
Map.addLayer(Cbasin, {}, 'Selected Basin: Lake Powell Watershed');

// Overlay global lake bathymetry data to provide geographic context.
// This helps visually locate Lake Powell and surrounding water bodies.
var globathy = ee.Image("projects/sat-io/open-datasets/GLOBathy/GLOBathy_bathymetry");
var basinLakes = globathy.clip(Colorado);
Map.addLayer(basinLakes, {palette: ['white']}, "Water Bodies (Lakes)");


// ===================================================================================
// STEP 2: Access and Filter Multi-Sensor Data
// ===================================================================================
// Define the 5-year climatology period.
// Note: A 5-year period is used for demonstration to optimize processing speed.
// Users can modify these dates to analyze different timeframes (format: 'YYYY-MM-DD').
var startDate = '2021-01-01';
var endDate   = '2026-01-01'; 
var smapTransitionDate = '2023-12-04'; // Transition date from SMAP V5 to V6

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
                    // Data Quality Filter: Values > 100 represent clouds, fill, or water.
                    // We update the mask to isolate only valid snow pixels (0-100%).
                    return img.updateMask(img.lte(100));
                  });

// Dataset 3: GPM IMERG Monthly Level 3 Version 7 (~11 km resolution)
var imergDataset = ee.ImageCollection('NASA/GPM_L3/IMERG_MONTHLY_V07')
                     .filterDate(startDate, endDate)
                     .filterBounds(Colorado)
                     .select('precipitation');

// Dataset 4: SMAP Level 3 Enhanced (Daily Surface Soil Moisture)
// Note: SMAP Version 5 processing ended on Dec 4, 2023, transitioning to Version 6. 
// We merge both collections to ensure a continuous dataset for our timeframe. 
// We select 'soil_moisture_am' (~6:00 AM overpass) as soil/vegetation are in thermal equilibrium.
var smapV5 = ee.ImageCollection('NASA/SMAP/SPL3SMP_E/005')
               .filterDate(startDate, smapTransitionDate)
               .filterBounds(Colorado)
               .select('soil_moisture_am');

var smapV6 = ee.ImageCollection('NASA/SMAP/SPL3SMP_E/006')
               .filterDate(smapTransitionDate, endDate)
               .filterBounds(Colorado)
               .select('soil_moisture_am');

// Merge the V5 and V6 collections into a single, continuous dataset.
var smapDataset = smapV5.merge(smapV6);


// ===================================================================================
// STEP 3: Calculate the 5-Year Monthly Mean Climatology
// ===================================================================================
/*
   GEE CONCEPT: Avoid standard 'for' loops for heavy processing. 
   Instead, we create a sequence of months (1-12) and use `.map()` to apply 
   our averaging functions across Google's servers in parallel.
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
       HYDROLOGY CONCEPT: IMERG natively provides a precipitation RATE (mm/hr). 
       We multiply the hourly average by 24 to convert it to average daily accumulation (mm/day).
    */
    var precipMonth = imergDataset.filter(ee.Filter.calendarRange(m, m, 'month'))
                                  .mean().multiply(24).rename('precipitation_daily');

    // -- SMAP Processing (State Variable) --
    // Volumetric soil moisture (m^3/m^3) requires no conversion.
    var smapMonth = smapDataset.filter(ee.Filter.calendarRange(m, m, 'month')).mean();

    // Combine all sensor bands into a single composite image for this specific month.
    var combinedMonthly = gldasMonth.addBands(snowMonth)
                                    .addBands(precipMonth)
                                    .addBands(smapMonth);

    // Set metadata properties so GEE knows which month and time this image represents.
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
   averages is computationally faster than clipping thousands of daily raw images in Step 2.
*/
var Param_watershed = monthlyClimatology.map(function(img) {
  var clippedImg = img.clip(Colorado);

  /* 
     HYDROLOGY CONCEPT: GLDAS runoff is natively provided as a rate (kg/m^2/s).
     Since 1 kg of water spread over 1 square meter equals 1 millimeter in depth,
     we multiply by 86,400 (seconds in a day) to convert this to mm/day.
  */
  var runoffDaily = clippedImg.select('Qs_tavg').multiply(86400);
  var srunoffDaily = clippedImg.select('Qsb_tavg').multiply(86400);

  // Add surface runoff and sub-surface baseflow to calculate Total Runoff.
  var trunoffDaily = runoffDaily.add(srunoffDaily).rename('Total_Runoff_daily');
  
  // Overwrite the original bands with our newly calculated daily rate bands.
  return clippedImg
        .addBands(runoffDaily, null, true)  
        .addBands(srunoffDaily, null, true) 
        .addBands(trunoffDaily);            
});

print('5-Year Monthly Climatology (All Variables):', Param_watershed);

// ===================================================================================
// STEP 5: Map Visualization (Looping through 12 months)
// ===================================================================================
// Define visualization parameters: color palettes and min/max data ranges.
var visParamsPrecip = {min: 0, max: 10, palette: ['white', 'blue', 'cyan', 'green', 'yellow', 'red']}; 
var visParamsSM = {min: 0, max: 0.5, palette: ['8B4513', 'FFD700', '00FF00', '0000FF']}; // Brown to Blue
var visParamsSnow = {min: 0, max: 100, palette: ['black', 'cyan', 'blue', 'white']}; 
var visParamsSWE = {min: 0, max: 20, palette: ['blue', 'green', 'yellow', 'orange', 'red']}; 
var visParamsRunoff = {min: 0, max: 0.08, palette: ['blue', 'green', 'yellow', 'orange', 'red']}; 

// Loop through months 1 to 12 to add them as individual map layers in the interface.
for (var i = 1; i <= 12; i++) {
  var monthImg = Param_watershed.filter(ee.Filter.eq('month', i)).first();

  /* 
    MEMORY MANAGEMENT: The visibility flag is set to 'false' for all layers initially. 
    This prevents rendering all 60 layers at once, which could crash the browser. 
    Users can manually toggle specific months on/off via the "Layers" tab.
  */
  Map.addLayer(monthImg.select('precipitation_daily'), visParamsPrecip, 'Month ' + i + ' - Average Daily Precip Rate', false);
  Map.addLayer(monthImg.select('soil_moisture_am'), visParamsSM, 'Month ' + i + ' - Mean Surface SM (AM)', false);
  Map.addLayer(monthImg.select('NDSI_Snow_Cover'), visParamsSnow, 'Month ' + i + ' - Mean Snow Cover (%)', false);
  Map.addLayer(monthImg.select('SWE_tavg'), visParamsSWE, 'Month ' + i + ' - Mean SWE', false);
  Map.addLayer(monthImg.select('Total_Runoff_daily'), visParamsRunoff, 'Month ' + i + ' - Total Mean Runoff', false);
}


// ===================================================================================
// STEP 6: Add Legends to the UI
// ===================================================================================
// Helper function to create a color bar and legend for a specific variable
function createLegend(title, visParams, units) {
  var legend = ui.Panel({
    style: { padding: '8px 15px', position: 'bottom-right', backgroundColor: 'rgba(255, 255, 255, 0.9)' }
  });

  // Legend Title
  var legendTitle = ui.Label({
    value: title + ' (' + units + ')',
    style: { fontWeight: 'bold', fontSize: '14px', margin: '0 0 4px 0', padding: '0' }
  });
  legend.add(legendTitle);

  // Generate the color bar image
  var makeColorBarParams = function(palette) {
    return {
      bbox: [0, 0, 1, 0.1],
      dimensions: '100x10',
      format: 'png',
      min: 0,
      max: 1,
      palette: palette,
    };
  };
  
  var colorBar = ui.Thumbnail({
    image: ee.Image.pixelLonLat().select(0),
    params: makeColorBarParams(visParams.palette),
    style: { stretch: 'horizontal', margin: '0px 8px', maxHeight: '24px' },
  });

  // Legend Labels (Min / Max)
  var legendLabels = ui.Panel({
    widgets: [
      ui.Label(visParams.min, {margin: '4px 8px'}),
      ui.Label((visParams.max / 2), {margin: '4px 8px', textAlign: 'center', stretch: 'horizontal'}),
      ui.Label(visParams.max, {margin: '4px 8px'})
    ],
    layout: ui.Panel.Layout.flow('horizontal')
  });

  legend.add(colorBar);
  legend.add(legendLabels);
  return legend;
}

// Create a master panel to hold all legends
var masterLegendPanel = ui.Panel({
  style: { position: 'bottom-left', padding: '8px', backgroundColor: 'white', border: '1px solid black' }
});

// Add main title for the legend panel
masterLegendPanel.add(ui.Label('Variable Legends', {fontWeight: 'bold', fontSize: '16px', margin: '0 0 10px 0'}));

// Add individual legends to the master panel
masterLegendPanel.add(createLegend('Precipitation', visParamsPrecip, 'mm/day'));
masterLegendPanel.add(createLegend('Soil Moisture', visParamsSM, 'm³/m³'));
masterLegendPanel.add(createLegend('Snow Cover', visParamsSnow, '%'));
masterLegendPanel.add(createLegend('SWE', visParamsSWE, 'kg/m²'));
masterLegendPanel.add(createLegend('Runoff', visParamsRunoff, 'mm/day'));

// Add the master panel to the map
Map.add(masterLegendPanel);

// ===================================================================================
// End of Script
// ===================================================================================
