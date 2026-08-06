/*                      
======================================================================================================
ARSET Training: NASA Earth Observations for Reservoir and Water Utility Management
Demonstration: Runoff, Precipitation, Soil Moisture, and Anomalies for the Lake Itaipu Watershed 
Datasets: GLDAS (Runoff), GPM IMERG (Precipitation), and SMAP Level 3 v5 & v6 (Soil Moisture)
Authors: Amita Mehta, Sean McCartney 
------------------------------------------------------------------------------------------------------
Script Description: 
This script uses the Lake Itaipu watershed as a case study to demonstrate how to:
  1. Define a watershed boundary using the HydroBASINS dataset.
  2. Access GLDAS Runoff, IMERG Precipitation, and merge SMAP L3 Soil Moisture (v5 + v6) 
     to create a continuous 10-year record.
  3. Generate a complete monthly mean climatology for all three datasets (2016-2026).
  4. Perform mathematical unit conversions to standardize outputs to millimeters per day (mm/day).
  5. Chart the 10-year mean monthly climatology to establish a seasonal baseline.
  6. Calculate monthly anomalies (Target - Baseline) for a specific target month/year (e.g., August 2021).
  7. Extract statistical averages for the watershed and visualize the anomalies on the map.
------------------------------------------------------------------------------------------------------
Terms of Use:
This code is free and open. By using this code you agree to cite the following reference:
NASA Applied Remote Sensing Training (ARSET) program.
======================================================================================================

=======================================================================================================
                                               DISCLAIMER
Every effort is made to ensure the code is free of errors but there is no warranty for the maps 
and their features are either spatially or temporally accurate or fit for a particular use. 
This code is provided without any warranty of any kind whatsoever, either express or implied.
=======================================================================================================   
*/

// ===================================================================================
// STEP 1: Define the Region of Interest (ROI) - Lake Itaipu Watershed
// ===================================================================================
// HydroBASINS provides watershed boundaries at various scales (Pfafstetter levels).
// We use Level 4 to capture the broader regional basin feeding Lake Itaipu.
//
// PRO-TIP: HOW TO FIND OTHER BASINS
// 1. Turn on the 'HydroSHEDS' layer via the Layers menu (top right of the map).
// 2. Click the 'Inspector' tab in the top-right console.
// 3. Click any watershed polygon on the map. 
// 4. Expand the feature's properties in the Inspector to find its unique 'HYBAS_ID'.

var basins = ee.FeatureCollection('WWF/HydroSHEDS/v1/Basins/hybas_4'); 
var Parana = basins.filter(ee.Filter.eq('HYBAS_ID', 6040814830)); // Isolate Lake Itaipu
Map.addLayer(basins, {}, 'HydroSHEDS', false); // Loaded but hidden by default
  
// Center the map view on the basin coordinates and set a base terrain map
Map.setCenter(-53.3, -24.4, 7); 
Map.setOptions('TERRAIN'); 

// Create a hollow, styled outline for the basin boundary to display over the data
var Pbasin = Parana.style({
  color: 'gray',          
  fillColor: '00000000',  // The '00' at the end makes the inside perfectly transparent
  width: 2                
});
Map.addLayer(Pbasin, {}, 'Selected Basin: Lake Itaipu Watershed');


// ===================================================================================
// STEP 2: Access and Filter Multi-Sensor Data
// ===================================================================================
// Define the 10-year climatology baseline period
var startClim = '2016-01-01';
var endClim   = '2026-01-01'; 

// SMAP Versioning Note: Processing for Version 5 ended on December 4, 2023, 
// and transitioned to Version 6. While historical data will eventually be 
// reprocessed into Version 6, we currently merge both collections to ensure 
// a continuous, uninterrupted dataset for our timeframe.
var smapTransitionDate = '2023-12-04'; 

// --- Dataset 1: GLDAS version 2.2 (Daily Runoff) ---
// Select both surface runoff ('Qs_tavg') and subsurface baseflow ('Qsb_tavg')
var gldasDataset = ee.ImageCollection('NASA/GLDAS/V022/CLSM/G025/DA1D')
                     .filterDate(startClim, endClim)
                     .filterBounds(Parana) 
                     .select(['Qs_tavg','Qsb_tavg']);

// --- Dataset 2: GPM IMERG Monthly Level 3 Version 7 (Precipitation) ---
var imergDataset = ee.ImageCollection('NASA/GPM_L3/IMERG_MONTHLY_V07')
                     .filterDate(startClim, endClim)
                     .filterBounds(Parana)
                     .select('precipitation');

// --- Dataset 3: SMAP Level 3 Enhanced (Daily Surface Soil Moisture) ---
// We select 'soil_moisture_am' (~6:00 AM overpass) because soil and vegetation 
// are typically in thermal equilibrium in the morning.
var smapV5 = ee.ImageCollection('NASA/SMAP/SPL3SMP_E/005')
               .filterDate(startClim, smapTransitionDate)
               .filterBounds(Parana)
               .select('soil_moisture_am');

var smapV6 = ee.ImageCollection('NASA/SMAP/SPL3SMP_E/006')
               .filterDate(smapTransitionDate, endClim)
               .filterBounds(Parana)
               .select('soil_moisture_am');

// Merge the collections into a single, continuous dataset
var smapDataset = smapV5.merge(smapV6);


// ===================================================================================
// STEP 3: Calculate the Monthly Mean Climatology (The 10-Year Baseline)
// ===================================================================================
// Create a sequential list from 1 to 12 representing the months of the year
var months = ee.List.sequence(1, 12);

// Map a function over each month to calculate the historical 10-year mean
var monthlyClimatology = ee.ImageCollection.fromImages(
  months.map(function(m) {
    
    // Filter GLDAS for the specific month across all 10 years and calculate the mean
    var runoffMonth = gldasDataset.filter(ee.Filter.calendarRange(m, m, 'month')).mean();
    
    // Filter IMERG for the specific month and calculate the mean
    // Unit Conversion: IMERG natively provides mm/hr. Multiply by 24 to get mm/day.
    var precipMonth = imergDataset.filter(ee.Filter.calendarRange(m, m, 'month'))
                                  .mean().multiply(24).rename('precipitation_daily');

    // Filter SMAP for the specific month and calculate the mean
    var smapMonth = smapDataset.filter(ee.Filter.calendarRange(m, m, 'month')).mean();

    // Stack the 3 variables into a single multi-band image representing this month
    return runoffMonth.addBands(precipMonth)
                      .addBands(smapMonth)
                      .set('month', m)
                      .set('system:time_start', ee.Date.fromYMD(2016, ee.Number(m), 1).millis());
  })
);


// ===================================================================================
// STEP 4: Clip to Watershed and Standardize Runoff Units
// ===================================================================================
// Iterate over the climatology images to standardize the GLDAS runoff units
var clim_watershed = monthlyClimatology.map(function(img) {
  var clipped = img.clip(Parana); // Confine data to the watershed boundary
  
  // Unit Conversion: GLDAS runoff is provided as a rate (kg/m^2/s).
  // Because 1 kg/m^2 equals 1 mm of water, we multiply by 86,400 (seconds in a day) 
  // to convert the rate to mm/day.
  var surfaceRunoff = clipped.select('Qs_tavg').multiply(86400);
  var baseFlow = clipped.select('Qsb_tavg').multiply(86400);
  
  // Add surface runoff and baseflow together to calculate total daily runoff
  var totalRunoff = surfaceRunoff.add(baseFlow).rename('Total_Runoff_daily');
  
  // Return the image with the newly calculated Total Runoff band appended
  return clipped.addBands(totalRunoff);             
});


// ===================================================================================
// STEP 5: Chart the 10-Year Mean Monthly Climatology 
// ===================================================================================
// Define arrays for the bands, display titles, and chart colors
var climBands  = ['precipitation_daily', 'Total_Runoff_daily', 'soil_moisture_am']; 
var climTitles = ['Precipitation (mm/day)', 'Runoff (mm/day)', 'Soil Moisture (m3/m3)'];
var climColors = ['blue', 'green', 'brown'];
var climScale = [10000,25000, 9000]

// Loop over each band name in the array to generate a separate chart
climBands.forEach(function(band, index) {
  
  // Isolate just the current variable from the full climatology collection
  var singleVariableCollection = clim_watershed.select(band);
  
  // Create a time series chart calculating the watershed average for each month
  var timeSeriesChart = ui.Chart.image.series({
    imageCollection: singleVariableCollection,
    region: Parana, 
    reducer: ee.Reducer.mean(), 
    scale: climScale[index] 
  })
  .setOptions({
    // Use the arrays above to dynamically name and color each chart
    title: '10-year Mean Monthly ' + climTitles[index],
    vAxis: {title: climTitles[index]}, // Leaving min/max blank auto-scales perfectly
    hAxis: {title: 'Month', format: 'MMM', gridlines: {count: 12}},
    lineWidth: 2,
    pointSize: 4,
    colors: [climColors[index]]
  });
  
  // Set as a line chart and print to the console
  var finalChart = timeSeriesChart.setChartType('LineChart');
  print(finalChart);
});


// ===================================================================================
// STEP 6: Calculate Anomaly for a Specific Target Month and Year
// Formula: Anomaly = Target Month Conditions - Historical Baseline Conditions
// ===================================================================================
// Define the specific month and year to investigate
var targetYear = 2021;
var targetMonth = 8; // 8 = August

// 1. Retrieve the historical baseline climatology specifically for the target month
var climAugust = clim_watershed.filter(ee.Filter.eq('month', targetMonth)).first();

// 2. Define the exact start and end dates for the target month (e.g., August 1st to Sept 1st)
var startTarget = ee.Date.fromYMD(targetYear, targetMonth, 1);
var endTarget = startTarget.advance(1, 'month');

// Optional Verification: Print the number of images found to ensure data exists
print('GLDAS images found:', gldasDataset.filterDate(startTarget, endTarget).size());
print('IMERG images found:', imergDataset.filterDate(startTarget, endTarget).size());
print('SMAP images found:', smapDataset.filterDate(startTarget, endTarget).size());

// 3. Process the Target Data (applying the exact same unit conversions as Step 3 & 4)
// Runoff
var runoffTarget = gldasDataset.filterDate(startTarget, endTarget).mean().clip(Parana);
var surfaceRunoffTarget = runoffTarget.select('Qs_tavg').multiply(86400);
var baseFlowTarget = runoffTarget.select('Qsb_tavg').multiply(86400);
var totalRunoffTarget = surfaceRunoffTarget.add(baseFlowTarget).rename('Total_Runoff_daily');

// Precipitation
var precipTarget = imergDataset.filterDate(startTarget, endTarget)
                               .mean().clip(Parana).multiply(24).rename('precipitation_daily');
                               
// Soil Moisture
var smapTarget = smapDataset.filterDate(startTarget, endTarget)
                            .mean().clip(Parana).rename('soil_moisture_am');

// Combine the 3 processed target variables into a single image stack
var targetAugustImg = precipTarget.addBands(totalRunoffTarget).addBands(smapTarget);

// 4. Calculate the Anomaly 
// Note: Earth Engine requires images to have the exact same bands before subtraction.
// We select just our 3 final variables from the climatology image to match our target image.
var climAugustMatched = climAugust.select(['precipitation_daily', 'Total_Runoff_daily', 'soil_moisture_am']);

// Subtract the Baseline (climatology) from the Target (August 2021)
var AugustAnomaly = targetAugustImg.subtract(climAugustMatched)
                               .set('month', targetMonth)
                               .set('year', targetYear)
                               .set('system:time_start', startTarget.millis());


// ===================================================================================
// STEP 7: Extract Statistics and Visualize the Anomalies
// ===================================================================================

// 1. Calculate the spatial average of the anomalies across the entire watershed polygon
// The reduceRegion function takes the pixel-by-pixel map and calculates a single summary statistic.
var basinMeanAnomalies = AugustAnomaly.reduceRegion({
  reducer: ee.Reducer.mean(), // Calculate the mathematical average
  geometry: Parana,           // Confine the calculation to the Parana watershed boundary
  scale: 10000,               // Process the data at a 10km spatial resolution (matching IMERG)
  maxPixels: 1e9              // Safety override allowing up to 1 billion pixels to be processed
});

// Print the exact numerical anomaly values to the Earth Engine Console
print('Mean Anomalies for Lake Itaipu Watershed (August 2021):');
print(basinMeanAnomalies);

// 2. Add the Precipitation Anomaly to the Map
// Palette logic: Negative values (Red) = Drier than normal, 0 (White) = Normal, Positive (Blue) = Wetter than normal
var precipAnomVis = {
  bands: ['precipitation_daily'],
  min: -3,   
  max: 3,
  palette: ['red', 'white', 'blue'] 
};
Map.addLayer(AugustAnomaly.clip(Parana), precipAnomVis, 'August 2021 Precip Anomaly');

// 3. Add the Runoff Anomaly to the Map
// We use a slightly tighter min/max scale since runoff variations are typically smaller than precipitation
var runoffAnomVis = {
  bands: ['Total_Runoff_daily'],
  min: -2,   
  max: 2,
  palette: ['red', 'white', 'blue'] 
};
// The 'false' parameter at the end loads the layer into the map but keeps it hidden by default
Map.addLayer(AugustAnomaly.clip(Parana), runoffAnomVis, 'August 2021 Runoff Anomaly', false); 

// 4. Add the Soil Moisture Anomaly to the Map
// Volumetric soil moisture (m3/m3) is measured as a small fraction, so the scale is much smaller (-0.1 to 0.1)
var smAnomVis = {
  bands: ['soil_moisture_am'],
  min: -0.1,   
  max: 0.1,
  palette: ['red', 'white', 'blue']
};
Map.addLayer(AugustAnomaly.clip(Parana), smAnomVis, 'August 2021 Soil Moisture Anomaly', false); 

// ===================================================================================
// End of Script
// ===================================================================================
