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
     to create a continuous 5-year record.
  3. Generate a complete monthly mean climatology for all three datasets (2016-2026).
  4. Perform mathematical unit conversions to standardize outputs to millimeters per day (mm/day).
  5. Chart the 5-year mean monthly climatology to establish a seasonal baseline.
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
// Define the 5-year climatology baseline period
var startClim = '2021-01-01';
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
//                    
// Find  Monthly mean runoff from daily data for each year.
// Define the years and months to iterate over
var startYear = ee.Date(startClim).get('year');
var endYear = ee.Date(endClim).get('year'); 
var years = ee.List.sequence(startYear, ee.Number(endYear).subtract(1));
var months = ee.List.sequence(1, 12);
//  
// Find Monthly mean runoff from daily data for each year and month. 
// convert units, and calculate Total Runoff.
var gldasMonthly = ee.ImageCollection.fromImages(
  years.map(function(y) {
    return months.map(function(m) {
      
      // Filter the collection by the specific year and month
      var filtered = gldasDataset
        .filter(ee.Filter.calendarRange(y, y, 'year'))
        .filter(ee.Filter.calendarRange(m, m, 'month'));
      
      // Calculate the mean for the month
      var monthlyMean = filtered.mean();
      
      // Unit Conversion: Multiply by 86400 (seconds in a day) to convert from kg/m^2/s to mm/day
      var surfaceRunoff = monthlyMean.select('Qs_tavg').multiply(86400);
      var baseFlow = monthlyMean.select('Qsb_tavg').multiply(86400);
      
      // Add surface runoff and baseflow together
      var totalRunoff = surfaceRunoff.add(baseFlow).rename('Total_Runoff_daily');
      
      // Return the new Total Runoff image with the time properties attached
      return totalRunoff
        .set('system:time_start', ee.Date.fromYMD(y, m, 1).millis())
        .set('year', y)
        .set('month', m);
    });
  }).flatten()
);
print('GLDAS Monthly Total Runoff (mm/day):', gldasMonthly);

// --- Dataset 2: GPM IMERG Monthly Level 3 Version 7 (Precipitation) ---
var imergDataset = ee.ImageCollection('NASA/GPM_L3/IMERG_MONTHLY_V07')
                     .filterDate(startClim, endClim)
                     .filterBounds(Parana)
                     .select('precipitation')
                     .map(function(img) {
                       // Multiply by 24 hr to convert from mm/hr to mm/day
                       var precipDaily = img.multiply(24).rename('precipitation_daily');
                       
                       // Copy original properties (like time_start) to the new image
                       return precipDaily.copyProperties(img, img.propertyNames());
                     });

print('IMERG Monthly Precipitation (mm/day):', imergDataset);

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
//
// Find Monthly mean soil moisture from daily data for each year.
//  Map over the years and months to calculate the average
var smapMonthly = ee.ImageCollection.fromImages(
  years.map(function(y) {
    return months.map(function(m) {
      
      // Filter the collection by the specific year and month
      var filtered = smapDataset
        .filter(ee.Filter.calendarRange(y, y, 'year'))
        .filter(ee.Filter.calendarRange(m, m, 'month'));
      
      // Calculate the mean. We also set a 'system:time_start' so the 
      // resulting images can be used in time series charts later.
      return filtered.mean()
        .set('system:time_start', ee.Date.fromYMD(y, m, 1).millis())
        .set('year', y)
        .set('month', m);
    });
  }).flatten()
);
 print(smapMonthly);
 
// ===================================================================================
// STEP 3: Combine Monthly Datasets and Calculate the N-Year Monthly Climatology
// ===================================================================================

// Map over the 12 months to calculate the historical 5-year mean for each variable
 var monthlyClimatology = ee.ImageCollection.fromImages(
  months.map(function(m) {
    
// 1. Filter GLDAS for the specific month across all 5 years and calculate the mean
// (It already has the Total_Runoff_daily band calculated)
    var runoffMonth = gldasMonthly
      .filter(ee.Filter.calendarRange(m, m, 'month'))
      .mean();
    
// 2. Filter IMERG for the specific month and calculate the mean
// (It already has the precipitation_daily band converted to mm/day)
    var precipMonth = imergDataset
      .filter(ee.Filter.calendarRange(m, m, 'month'))
      .mean();

// 3. Filter SMAP for the specific month and calculate the mean
    var smapMonth = smapMonthly
      .filter(ee.Filter.calendarRange(m, m, 'month'))
      .mean();

// 4. Combine precipitation, soil moisture and runoff datasets into a single multi-band image, clip to the watershed,
    // and attach time properties so they can be plotted sequentially in a chart.
    return runoffMonth
      .addBands(precipMonth)
      .addBands(smapMonth)
      .clip(Parana) // Confine the data to the Lake Itaipu watershed boundary
      .set('month', m)
      .set('system:time_start', ee.Date.fromYMD(2016, ee.Number(m), 1).millis());
  })
);

 print('Combined 5-Year Monthly Climatology:', monthlyClimatology);
//======================================================================
//Step 4: Plot climatology time series.
//======================================================================
// Define arrays for the bands, display titles, chart colors, and native spatial resolutions
var climBands  = ['precipitation_daily', 'Total_Runoff_daily', 'soil_moisture_am']; 
var climTitles = ['Precipitation (mm/day)', 'Runoff (mm/day)', 'Soil Moisture (m3/m3)'];
var climColors = ['blue', 'green', 'brown'];

// Define native scales in meters: [IMERG ~10 km, GLDAS ~25 km, SMAP ~9km]
var climScales = [10000, 25000, 9000]; 

// Loop over each band name in the array to generate a separate chart
climBands.forEach(function(band, index) {
  
  // Isolate just the current variable from the full climatology collection
  var singleVariableCollection = monthlyClimatology.select(band);
  
  // Create a time series chart calculating the watershed average for each month
  var timeSeriesChart = ui.Chart.image.series({
    imageCollection: singleVariableCollection,
    region: Parana, 
    reducer: ee.Reducer.mean(), 
    scale: climScales[index]  // <--- Dynamically applies the correct resolution!
  })
  .setOptions({
    // Use the arrays above to dynamically name and color each chart
    title: '5-year Mean Monthly ' + climTitles[index],
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
// STEP 4:  Anomaly Calculation - find basin-averaged monthly data
// ===================================================================================

// 1. Create a table (FeatureCollection) of the 12-month basin-averaged Climatology
var baselineTable = monthlyClimatology.map(function(img) {
  var stats = img.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: Parana.geometry(),
    scale: 25000, // GLDAS scale for speed
    maxPixels: 1e9
  });
  // Return just the numbers and the month 
  return ee.Feature(null, stats).set('month', img.get('month'));
});

  print('baselineTable:', baselineTable);

// 2. Create a List of 60 months, stack the raw bands, and reduce them to numbers
var totalMonths = ee.List.sequence(0, 59);

var rawMonthlyTable = ee.FeatureCollection(totalMonths.map(function(n) {
  var date = ee.Date(startClim).advance(n, 'month');
  var y = date.get('year');
  var m = date.get('month');
  
  var runoff = gldasMonthly.filter(ee.Filter.eq('year', y)).filter(ee.Filter.eq('month', m)).mean();
  var precip = imergDataset.filter(ee.Filter.calendarRange(y, y, 'year')).filter(ee.Filter.calendarRange(m, m, 'month')).mean();
  var smap =  smapMonthly.filter(ee.Filter.eq('year', y)).filter(ee.Filter.eq('month', m)).mean();
    
  var currentMonthImage = ee.Image(runoff).addBands(precip).addBands(smap);
  
  var stats = currentMonthImage.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: Parana.geometry(),
    scale: 25000,
    maxPixels: 1e9
  });
  
  return ee.Feature(null, stats)
    .set('system:time_start', date.millis())
    .set('month', m);
}));

// 3. Subtract the Baseline numbers from the Raw numbers for each month
// CRITICAL FIX: Filter out any months that are missing data due to satellite latency
var validRawMonthlyTable = rawMonthlyTable.filter(
  ee.Filter.notNull(['precipitation_daily', 'Total_Runoff_daily', 'soil_moisture_am'])
);

var anomalyTableFinal = validRawMonthlyTable.map(function(feat) {
  // Get the month of the current valid raw feature
  var m = feat.get('month');
  
  // Find the matching baseline month from the baseline table
  var baselineFeat = ee.Feature(baselineTable.filter(ee.Filter.eq('month', m)).first());
  
  // Extract the numbers and subtract Baseline from Actual
  var p_anomaly = ee.Number(feat.get('precipitation_daily')).subtract(ee.Number(baselineFeat.get('precipitation_daily')));
  var r_anomaly = ee.Number(feat.get('Total_Runoff_daily')).subtract(ee.Number(baselineFeat.get('Total_Runoff_daily')));
  var s_anomaly = ee.Number(feat.get('soil_moisture_am')).subtract(ee.Number(baselineFeat.get('soil_moisture_am')));
  
  // Return a new feature with just the anomalies and the date
  return ee.Feature(null, {
    'precipitation_daily': p_anomaly,
    'Total_Runoff_daily': r_anomaly,
    'soil_moisture_am': s_anomaly,
    'system:time_start': feat.get('system:time_start')
  });
});
print('Final Calculated Anomaly Table:', anomalyTableFinal);

// ===================================================================================
// STEP 5: Chart the Number-Based Anomalies
// ===================================================================================

// Define arrays for the variables, display titles, chart colors, and Y-axis labels
var anomalyVars   = ['Total_Runoff_daily', 'precipitation_daily', 'soil_moisture_am']; 
var anomalyTitles = ['5-Year Runoff Anomaly', '5-Year Precipitation Anomaly', '5-Year Soil Moisture Anomaly'];
var anomalyColors = ['blue', 'cyan', 'green'];
var anomalyYAxes  = ['Anomaly (mm/day)', 'Anomaly (mm/day)', 'Anomaly (m³/m³)'];

// Loop over each variable name in the array to generate a separate chart
 anomalyVars.forEach(function(variable, index) {
  
  // Create a time series chart for the single variable
  var singleChart = ui.Chart.feature.byFeature({
    features: anomalyTableFinal,
    xProperty: 'system:time_start', // X-axis is the date
    yProperties: [variable]         // Y-axis is the current variable in the loop
  })
  .setOptions({
    // Use the arrays above to dynamically name and color each chart
    title: anomalyTitles[index],
    vAxis: {title: anomalyYAxes[index]}, 
    hAxis: {title: 'Date', format: 'YYYY-MMM'},
    lineWidth: 2,
    pointSize: 0, // Set to 0 to keep clean lines without dots
    colors: [anomalyColors[index]] 
  });
  
  // Explicitly set as a line chart and print to the console
  print(singleChart.setChartType('LineChart'));
});
// ===================================================================================
// STEP 6: Calculate Anomaly for a Specific Target Month and Year
// Formula: Anomaly = Target Month Conditions - Historical Baseline Conditions
// ===================================================================================
// Define the specific month and year to investigate
var targetYear = 2023;
var targetMonth = 11; // 11 = November

// 1. Retrieve the historical baseline climatology specifically for the target month
var climFloodMon = monthlyClimatology.filter(ee.Filter.eq('month', targetMonth)).first();

// 2. Define the exact start and end dates for the target month (e.g., Novembet 1st to December 1st)
var startTarget = ee.Date.fromYMD(targetYear, targetMonth, 1);
var endTarget = startTarget.advance(1, 'month');

// Optional Verification: Print the number of images found to ensure data exists
print('GLDAS images found:', gldasMonthly.filterDate(startTarget, endTarget).size());
print('IMERG images found:', imergDataset.filterDate(startTarget, endTarget).size());
print('SMAP images found:', smapMonthly.filterDate(startTarget, endTarget).size());

// 3. Process the Target Data (applying the exact same unit conversions as Step 3 & 4)
// Runoff
// var totalrunoffTarget = gldasMonthly.filterDate(startTarget, endTarget).mean().clip(Parana);
//var surfaceRunoffTarget = runoffTarget.select('Qs_tavg').multiply(86400);
//var baseFlowTarget = runoffTarget.select('Qsb_tavg').multiply(86400);
// var totalRunoffTarget = gldasMonthly.add(baseFlowTarget).rename('Total_Runoff_daily');

// Total Runoff
var totalRunoffTarget = gldasMonthly.filterDate(startTarget, endTarget)
                               .mean().clip(Parana).rename('Total_Runoff_daily');
    
//                           
var precipTarget = imergDataset.filterDate(startTarget, endTarget)
                               .mean().clip(Parana).rename('precipitation_daily');
                         
// Soil Moisture
var smapTarget = smapMonthly.filterDate(startTarget, endTarget)
                            .mean().clip(Parana).rename('soil_moisture_am');

// Combine the 3 processed target variables into a single image stack
var targetFloodImg = precipTarget.addBands(totalRunoffTarget).addBands(smapTarget);

// 4. Calculate the Anomaly 
// Note: Earth Engine requires images to have the exact same bands before subtraction.
// We select just our 3 final variables from the climatology image to match our target image.
var climFloodMatched = climFloodMon.select(['precipitation_daily', 'Total_Runoff_daily', 'soil_moisture_am']);

// Subtract the Baseline (climatology) from the Target (August 2021)
var FloodAnomaly = targetFloodImg.subtract(climFloodMatched)
                               .set('month', targetMonth)
                               .set('year', targetYear)
                               .set('system:time_start', startTarget.millis());


// ===================================================================================
// STEP 7: Extract Statistics and Visualize the Anomalies
// ===================================================================================

// 1. Calculate the spatial average of the anomalies across the entire watershed polygon
// The reduceRegion function takes the pixel-by-pixel map and calculates a single summary statistic.
var basinMeanAnomalies = FloodAnomaly.reduceRegion({
  reducer: ee.Reducer.mean(), // Calculate the mathematical average
  geometry: Parana,           // Confine the calculation to the Parana watershed boundary
  scale: 10000,               // Process the data at a 10km spatial resolution (matching IMERG)
  maxPixels: 1e9              // Safety override allowing up to 1 billion pixels to be processed
});

// Print the exact numerical anomaly values to the Earth Engine Console
print('Mean Anomalies for Lake Itaipu Watershed (November 2023):');
print(basinMeanAnomalies);

// 2. Add the Precipitation Anomaly to the Map
// Palette logic: Negative values (Red) = Drier than normal, 0 (White) = Normal, Positive (Blue) = Wetter than normal
var precipAnomVis = {
  bands: ['precipitation_daily'],
  min: -3,   
  max: 3,
  palette: ['red', 'white', 'blue'] 
};
Map.addLayer(FloodAnomaly.clip(Parana), precipAnomVis, 'November 2023 Precip Anomaly');

// 3. Add the Runoff Anomaly to the Map
// We use a slightly tighter min/max scale since runoff variations are typically smaller than precipitation
var runoffAnomVis = {
  bands: ['Total_Runoff_daily'],
  min: -2,   
  max: 2,
  palette: ['red', 'white', 'blue'] 
};
// The 'false' parameter at the end loads the layer into the map but keeps it hidden by default
Map.addLayer(FloodAnomaly.clip(Parana), runoffAnomVis, 'November 2023 Runoff Anomaly', false); 

// 4. Add the Soil Moisture Anomaly to the Map
// Volumetric soil moisture (m3/m3) is measured as a small fraction, so the scale is much smaller (-0.1 to 0.1)
var smAnomVis = {
  bands: ['soil_moisture_am'],
  min: -0.1,   
  max: 0.1,
  palette: ['red', 'white', 'blue']
};
Map.addLayer(FloodAnomaly.clip(Parana), smAnomVis, 'November 2023 Soil Moisture Anomaly', false); 

// ===================================================================================
// End of Script
// ===================================================================================
