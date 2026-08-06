/*                      
======================================================================================================
ARSET Training: NASA Earth Observations for Reservoir and Water Utility Management
Demonstration: Runoff, Precipitation, Soil Moisture, SWE, Snow Cover Anomalies for Lake Powell 
Datasets: GLDAS (Runoff & SWE), GPM IMERG (Precipitation), SMAP L3 v5/v6 (Soil Moisture), MODIS (Snow)
Authors: Amita Mehta, Sean McCartney  
------------------------------------------------------------------------------------------------------
Script Description: 
This script uses the Lake Powell watershed as a case study to demonstrate how to:
  1. Define a watershed boundary using the HydroBASINS dataset.
  2. Access and process Runoff, Precipitation, Soil Moisture, SWE, and Snow Cover.
  3. Generate a complete monthly mean climatology for all datasets (2021-2026).
  4. Chart the 5-year mean monthly climatology to establish a seasonal baseline.
  5. Calculate monthly anomalies (Target - Baseline) across the time series.
  6. Extract statistical averages and visualize the anomalies on the map for a target month.
  7. Add a universal map legend for the anomaly visualization.
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
// STEP 1: Define the Region of Interest (ROI) - Lake Powell Watershed
// ===================================================================================
// HydroBASINS provides watershed boundaries at various scales (Pfafstetter levels).
// We use Level 3 in this demonstration to capture the broader regional basin feeding Lake Powell.
//
// PRO-TIP: HOW TO FIND OTHER BASINS
// 1. Turn on the 'HydroSHEDS' layer via the Layers menu (top right of the map).
// 2. Click the 'Inspector' tab in the top-right console.
// 3. Click any watershed polygon on the map. 
// 4. Expand the feature's properties in the Inspector to find its unique 'HYBAS_ID'.
// Import the global HydroBASINS dataset at Level 3 resolution (large regional basins)
var basins = ee.FeatureCollection('WWF/HydroSHEDS/v1/Basins/hybas_3');
// Filter the global dataset to isolate the specific basin using its unique HYBAS_ID (Colorado Basin)
var Colorado = basins.filter(ee.Filter.eq('HYBAS_ID', 7030008710)); 

// Center the map view to the coordinates of the Lake Powell region at zoom level 5
Map.setCenter(-110, 37, 5);
// Change the default map background to show physical terrain and topography
Map.setOptions('TERRAIN'); 

// Create a visual style dictionary to draw a hollow outline of the basin
var Cbasin = Colorado.style({
  color: 'gray',         // Set the boundary line color to gray
  fillColor: '00000000', // The '00' at the end makes the inside fill completely transparent
  width: 2               // Set the thickness of the boundary line
});

// Load the global basins layer to the map, but set visibility to 'false' so it is hidden by default
Map.addLayer(basins, {}, 'HydroSHEDS (Global)', false); 
// Add our custom hollow Colorado basin outline to the map so we can see it over the terrain
Map.addLayer(Cbasin, {}, 'Selected Basin: Lake Powell Watershed');

// ===================================================================================
// STEP 2: Access and Filter Multi-Sensor Data
// ===================================================================================
// Define the start date for our 5-year historical climatology baseline (January 1, 2021)
var startClim = '2021-01-01';
// Define the end date for our 5-year historical climatology baseline (January 1, 2026)
var endClim   = '2026-01-01'; 
// Define the specific date when SMAP transitioned from Version 5 processing to Version 6
var smapTransitionDate = '2023-12-04'; 

// Extract just the numerical year (2021) from the startClim date string
var startYear = ee.Date(startClim).get('year');
// Extract just the numerical year (2026) from the endClim date string
var endYear = ee.Date(endClim).get('year'); 
// Create a list of years to iterate over (2021, 2022, 2023, 2024, 2025)
var years = ee.List.sequence(startYear, ee.Number(endYear).subtract(1));
// Create a list of numbers 1 through 12 representing the months of the year
var months = ee.List.sequence(1, 12);

// --- Dataset 1: GLDAS version 2.2 (Daily Runoff & SWE) ---
// Call the GLDAS daily image collection from the Earth Engine data catalog
var gldasDataset = ee.ImageCollection('NASA/GLDAS/V022/CLSM/G025/DA1D')
                     .filterDate(startClim, endClim) // Filter data to our 5-year baseline period
                     .filterBounds(Colorado)         // Filter out tiles that don't intersect our basin
                     .select(['SWE_tavg', 'Qs_tavg', 'Qsb_tavg']); // Keep only SWE, surface runoff, and baseflow

// Loop through each year, and within each year, loop through each month to create monthly averages
var gldasMonthly = ee.ImageCollection.fromImages(
  years.map(function(y) { // Start loop over the years
    return months.map(function(m) { // Start nested loop over the months
      // Filter the raw daily GLDAS data to match the exact year and month of the current loop iteration
      var filtered = gldasDataset
        .filter(ee.Filter.calendarRange(y, y, 'year'))
        .filter(ee.Filter.calendarRange(m, m, 'month'));
      // Calculate the mathematical mean (average) of all daily images in that specific month
      var monthlyMean = filtered.mean();
      
      // Convert surface runoff from kg/m^2/s to mm/day by multiplying by seconds in a day (86400)
      var surfaceRunoff = monthlyMean.select('Qs_tavg').multiply(86400);
      // Convert subsurface baseflow from kg/m^2/s to mm/day by multiplying by seconds in a day (86400)
      var baseFlow = monthlyMean.select('Qsb_tavg').multiply(86400);
      // Add the surface runoff and baseflow together to get total runoff, and rename the band
      var totalRunoff = surfaceRunoff.add(baseFlow).rename('Total_Runoff_daily');
      // Select the Snow Water Equivalent (SWE) band; kg/m^2 is already equivalent to mm, no math needed
      var swe = monthlyMean.select('SWE_tavg'); 
      
      // Combine the Total Runoff and SWE bands into a single monthly image
      return totalRunoff.addBands(swe)
        .set('system:time_start', ee.Date.fromYMD(y, m, 1).millis()) // Tag image with a standard timestamp
        .set('year', y)   // Tag image with the loop's year for easy filtering later
        .set('month', m); // Tag image with the loop's month for easy filtering later
    }); // End month loop
  }).flatten() // Flatten the list of lists into a single continuous Image Collection
);

// --- Dataset 2: GPM IMERG Monthly Level 3 Version 7 (Precipitation) ---
// Call the IMERG Monthly precipitation collection (data is already aggregated by month!)
var imergDataset = ee.ImageCollection('NASA/GPM_L3/IMERG_MONTHLY_V07')
                     .filterDate(startClim, endClim) // Filter to the 5-year period
                     .filterBounds(Colorado)         // Filter spatially to the basin
                     .select('precipitation')        // Select the precipitation band (currently in mm/hr)
                     .map(function(img) {            // Apply a function to every image in the collection
                       // Multiply mm/hr by 24 to convert the data to mm/day, and rename the band
                       var precipDaily = img.multiply(24).rename('precipitation_daily');
                       // Return the new image but copy all the original time metadata so GEE can chart it
                       return precipDaily.copyProperties(img, img.propertyNames());
                     });

// --- Dataset 3: SMAP Level 3 Enhanced (Daily Surface Soil Moisture) ---
// Call the older Version 5 SMAP data catalog
var smapV5 = ee.ImageCollection('NASA/SMAP/SPL3SMP_E/005')
               .filterDate(startClim, smapTransitionDate) // Pull data up until the retirement date
               .filterBounds(UpperBasin)                  // Assuming UpperBasin is imported via Geometry tools
               .select('soil_moisture_am');               // Use morning pass (thermal equilibrium)

// Call the newer Version 6 SMAP data catalog
var smapV6 = ee.ImageCollection('NASA/SMAP/SPL3SMP_E/006')
               .filterDate(smapTransitionDate, endClim)   // Pull data from retirement date to the end of our period
               .filterBounds(UpperBasin)                  // Assuming UpperBasin is imported via Geometry tools
               .select('soil_moisture_am');               // Use morning pass

// Merge the V5 and V6 collections together to create one continuous 5-year dataset
var smapDataset = smapV5.merge(smapV6);

// Loop through each year and month to aggregate daily SMAP data into monthly averages
var smapMonthly = ee.ImageCollection.fromImages(
  years.map(function(y) { // Start year loop
    return months.map(function(m) { // Start month loop
      // Isolate SMAP data to the current year and month
      var filtered = smapDataset
        .filter(ee.Filter.calendarRange(y, y, 'year'))
        .filter(ee.Filter.calendarRange(m, m, 'month'));
      // Calculate the mean of those days, and tag it with time metadata
      return filtered.mean()
        .set('system:time_start', ee.Date.fromYMD(y, m, 1).millis())
        .set('year', y)
        .set('month', m);
    }); // End month loop
  }).flatten() // Flatten into a 1D Image Collection
);

// --- Dataset 4: MODIS Terra Snow Cover Daily L3 ---
// Call the MODIS daily snow cover collection
var snowCover = ee.ImageCollection('MODIS/061/MOD10A1')
                  .filterDate(startClim, endClim) // Filter to the 5-year period
                  .filterBounds(Colorado)         // Filter spatially to the basin
                  .select('NDSI_Snow_Cover')      // Select the Normalized Difference Snow Index band
                  .map(function(img) {            // Apply a quality control mask to all images
                    // Update the mask to drop pixels > 100 (which represent clouds, inland water, or missing data)
                    return img.updateMask(img.lte(100));
                  });

// Loop through each year and month to aggregate daily valid MODIS snow cover into monthly averages
var modisMonthly = ee.ImageCollection.fromImages(
  years.map(function(y) { // Start year loop
    return months.map(function(m) { // Start month loop
      // Isolate MODIS data to the current year and month
      var filtered = snowCover
        .filter(ee.Filter.calendarRange(y, y, 'year'))
        .filter(ee.Filter.calendarRange(m, m, 'month'));
      // Calculate the mean of those days, and tag it with time metadata
      return filtered.mean()
        .set('system:time_start', ee.Date.fromYMD(y, m, 1).millis())
        .set('year', y)
        .set('month', m);
    }); // End month loop
  }).flatten() // Flatten into a 1D Image Collection
);

// ===================================================================================
// STEP 3: Combine Monthly Datasets and Calculate Climatology
// ===================================================================================
// Loop strictly through the 12 months of a generic year to calculate the 5-year historical average for each month
var monthlyClimatology = ee.ImageCollection.fromImages(
  months.map(function(m) { // Start loop over numbers 1 to 12
    // Get all GLDAS images across all 5 years that match the current month, and average them
    var runoffSweMonth = gldasMonthly.filter(ee.Filter.calendarRange(m, m, 'month')).mean();
    // Get all IMERG images across all 5 years that match the current month, and average them
    var precipMonth = imergDataset.filter(ee.Filter.calendarRange(m, m, 'month')).mean();
    // Get all SMAP images across all 5 years that match the current month, and average them
    var smapMonth = smapMonthly.filter(ee.Filter.calendarRange(m, m, 'month')).mean();
    // Get all MODIS images across all 5 years that match the current month, and average them
    var modisMonth = modisMonthly.filter(ee.Filter.calendarRange(m, m, 'month')).mean();

    // Stack all variables into a single multi-band image representing this specific month's climatology
    return runoffSweMonth
      .addBands(precipMonth)
      .addBands(smapMonth)
      .addBands(modisMonth)
      .clip(UpperBasin) // Crop the final stacked image to the geometry of the Upper Basin
      .set('month', m)  // Tag it with the numerical month
      // Assign a year (2021) just so GEE can plot it in a sequence on an X-axis chart
      .set('system:time_start', ee.Date.fromYMD(2021, ee.Number(m), 1).millis());
  }) // End 12-month loop
);

//======================================================================
// Step 4: Plot climatology time series.
//======================================================================
// Define an array of exact band names we want to chart
var climBands  = ['precipitation_daily', 'Total_Runoff_daily', 'soil_moisture_am', 'SWE_tavg', 'NDSI_Snow_Cover']; 
// Define an array of readable titles for the charts
var climTitles = ['Precipitation (mm/day)', 'Runoff (mm/day)', 'Soil Moisture (m3/m3)', 'SWE (kg/m2)', 'Snow Cover (%)'];
// Define an array of colors to use for each chart line
var climColors = ['blue', 'green', 'brown', 'purple', 'cyan'];
// Define an array of the native spatial resolutions (in meters) for accurate mathematical sampling
var climScales = [10000, 25000, 9000, 25000, 500]; 

// Iterate through the array of bands to generate a separate chart for each one
climBands.forEach(function(band, index) { // Pass the band name and its index position in the array
  // Select just the current variable from the multi-band climatology collection
  var singleVariableCollection = monthlyClimatology.select(band);
  // Build a time series chart calculating the mean value across the basin geometry for each image
  var timeSeriesChart = ui.Chart.image.series({
    imageCollection: singleVariableCollection, // Feed it the single-variable image collection
    region: UpperBasin,                        // Calculate statistics only within the Upper Basin
    reducer: ee.Reducer.mean(),                // Summarize the pixels by calculating their average
    scale: climScales[index]                   // Use the dynamically matched resolution for processing speed
  })
  .setOptions({ // Customize chart aesthetics
    title: '5-year Mean Monthly ' + climTitles[index], // Use the dynamic title array
    vAxis: {title: climTitles[index]},                 // Label the Y-axis using the title array
    hAxis: {title: 'Month', format: 'MMM', gridlines: {count: 12}}, // Label X-axis with 3-letter months
    lineWidth: 2, pointSize: 4, colors: [climColors[index]]         // Apply line width, dot size, and color
  });
  // Explicitly tell Earth Engine to draw a Line Chart and print it to the console
  print(timeSeriesChart.setChartType('LineChart'));
});

// ===================================================================================
// STEP 5: Anomaly Calculation - Basin-averaged monthly data
// ===================================================================================
// Step 5A: Convert the image-based Climatology into a simple table of raw numbers for the 12 months
var baselineTable = monthlyClimatology.map(function(img) {
  // Use reduceRegion to calculate the spatial average of all bands inside the basin for a single image
  var stats = img.reduceRegion({
    reducer: ee.Reducer.mean(), // Calculate average
    geometry: UpperBasin,       // Constrain to Upper Basin
    scale: 25000,               // Use a coarse scale (25km) to make the script run faster. (NOTE: can adapt this script to a higher resolution if processing allows!)
    maxPixels: 1e9              // Allow processing of up to 1 billion pixels to prevent memory errors
  });
  // Return an empty feature (no geometry) containing just the statistics dictionary and the month number
  return ee.Feature(null, stats).set('month', img.get('month'));
});

// Create a list of numbers from 0 to 59, representing the 60 continuous months in our 5-year timeframe
var totalMonths = ee.List.sequence(0, 59);

// Step 5B: Convert all the raw monthly satellite images into a simple table of 60 rows (one for each month)
var rawMonthlyTable = ee.FeatureCollection(totalMonths.map(function(n) { // Loop over the 60 numbers
  // Advance the start date by 'n' months to figure out the exact date for this step of the loop
  var date = ee.Date(startClim).advance(n, 'month');
  var y = date.get('year'), m = date.get('month'); // Extract the year and month
  
  // Pull the pre-calculated monthly average for GLDAS (Runoff & SWE) for this specific year/month
  var runoffSwe = gldasMonthly.filter(ee.Filter.eq('year', y)).filter(ee.Filter.eq('month', m)).mean();
  // Pull the pre-calculated monthly average for IMERG for this specific year/month
  var precip = imergDataset.filter(ee.Filter.calendarRange(y, y, 'year')).filter(ee.Filter.calendarRange(m, m, 'month')).mean();
  // Pull the pre-calculated monthly average for SMAP for this specific year/month
  var smap = smapMonthly.filter(ee.Filter.eq('year', y)).filter(ee.Filter.eq('month', m)).mean();
  // Pull the pre-calculated monthly average for MODIS for this specific year/month
  var snow = modisMonthly.filter(ee.Filter.eq('year', y)).filter(ee.Filter.eq('month', m)).mean();
    
  // Combine all four variables into a single multi-band image for this specific month in the timeline
  var currentMonthImage = ee.Image(runoffSwe).addBands(precip).addBands(smap).addBands(snow);
  
  // Calculate the spatial average of all those bands inside the basin
  var stats = currentMonthImage.reduceRegion({
    reducer: ee.Reducer.mean(), // Calculate average
    geometry: UpperBasin,       // Constrain to Upper Basin
    scale: 25000,               // Use 25km scale for speed
    maxPixels: 1e9              // Safety override for pixel limit
  });
  
  // Return a feature containing the raw averaged values, tagged with the timestamp and month
  return ee.Feature(null, stats)
    .set('system:time_start', date.millis())
    .set('month', m);
}));

// Step 5C: Clean up the data by filtering out any months where satellites failed to report data (null values)
var validRawMonthlyTable = rawMonthlyTable.filter(
  ee.Filter.notNull(['precipitation_daily', 'Total_Runoff_daily', 'soil_moisture_am', 'SWE_tavg', 'NDSI_Snow_Cover'])
);

// Step 5D: Perform the actual Anomaly calculation (Raw Data - Baseline Data) for every month
var anomalyTableFinal = validRawMonthlyTable.map(function(feat) { // Loop over every row in the valid raw table
  var m = feat.get('month'); // Check which month this row represents (e.g., "July")
  // Find the matching "July" row from our 12-month baseline climatology table
  var baselineFeat = ee.Feature(baselineTable.filter(ee.Filter.eq('month', m)).first());
  
  // For each variable, cast it as a number, and subtract the baseline number from the raw number
  return ee.Feature(null, {
    'precipitation_daily': ee.Number(feat.get('precipitation_daily')).subtract(ee.Number(baselineFeat.get('precipitation_daily'))),
    'Total_Runoff_daily': ee.Number(feat.get('Total_Runoff_daily')).subtract(ee.Number(baselineFeat.get('Total_Runoff_daily'))),
    'soil_moisture_am': ee.Number(feat.get('soil_moisture_am')).subtract(ee.Number(baselineFeat.get('soil_moisture_am'))),
    'SWE_tavg': ee.Number(feat.get('SWE_tavg')).subtract(ee.Number(baselineFeat.get('SWE_tavg'))),
    'NDSI_Snow_Cover': ee.Number(feat.get('NDSI_Snow_Cover')).subtract(ee.Number(baselineFeat.get('NDSI_Snow_Cover'))),
    'system:time_start': feat.get('system:time_start') // Pass along the timestamp so we can chart it
  });
});

// ===================================================================================
// STEP 6: Chart the Number-Based Anomalies
// ===================================================================================
// Define an array of the exact variable names saved in our Anomaly table
var anomalyVars   = ['Total_Runoff_daily', 'precipitation_daily', 'soil_moisture_am', 'SWE_tavg', 'NDSI_Snow_Cover']; 
// Define an array of readable titles for the anomaly charts
var anomalyTitles = ['Runoff Anomaly', 'Precipitation Anomaly', 'Soil Moisture Anomaly', 'SWE Anomaly', 'Snow Cover Anomaly'];
// Define an array of colors to use for the anomaly charts
var anomalyColors = ['blue', 'cyan', 'green', 'purple', 'lightblue'];
// Define an array of Y-axis labels indicating the units for the anomalies
var anomalyYAxes  = ['Anomaly (mm/day)', 'Anomaly (mm/day)', 'Anomaly (m³/m³)', 'Anomaly (kg/m2)', 'Anomaly (%)'];

// Loop through each variable to generate an individual anomaly time-series chart
anomalyVars.forEach(function(variable, index) { // Pass the variable and index
  // Build a chart drawing a line through the sequence of features in our table
  var singleChart = ui.Chart.feature.byFeature({
    features: anomalyTableFinal,     // Feed it our final calculated anomaly table
    xProperty: 'system:time_start',  // Use the timestamp for the X-axis
    yProperties: [variable]          // Use the current loop variable for the Y-axis
  })
  .setOptions({ // Customize chart aesthetics
    title: anomalyTitles[index], vAxis: {title: anomalyYAxes[index]}, // Dynamic titles
    hAxis: {title: 'Date', format: 'YYYY-MMM'},                       // Format X-axis labels
    lineWidth: 2, pointSize: 0, colors: [anomalyColors[index]]        // Line style; 0 pointSize removes dots
  });
  // Explicitly tell Earth Engine to draw a Line Chart and print it to the console
  print(singleChart.setChartType('LineChart'));
});

// ===================================================================================
// STEP 7: Calculate Anomaly for a Specific Target Month and Year
// ===================================================================================
// Define the specific year we want to investigate visually on the map. (NOTE: edit the target year for your own analysis!)
var targetYear = 2025;
// Define the specific month (January) we want to investigate visually on the map. (NOTE: edit the target month for your own analysis!)
var targetMonth = 01; 

// Retrieve the baseline climatology image for January (month 01)
var climFloodMon = monthlyClimatology.filter(ee.Filter.eq('month', targetMonth)).first();
// Define an Earth Engine date object for the very first day of the target month
var startTarget = ee.Date.fromYMD(targetYear, targetMonth, 1);
// Define an Earth Engine date object for exactly one month later (to define the end boundary)
var endTarget = startTarget.advance(1, 'month');

// Filter GLDAS to our target month, calculate the mean, and crop it to the Upper Basin geometry
var runoffSweTarget = gldasMonthly.filterDate(startTarget, endTarget).mean().clip(UpperBasin);
// Isolate just the total runoff band from the GLDAS target image
var totalRunoffTarget = runoffSweTarget.select('Total_Runoff_daily');
// Isolate just the SWE band from the GLDAS target image
var sweTarget = runoffSweTarget.select('SWE_tavg');
// Filter IMERG to our target month, calculate the mean, crop to basin, and rename the band
var precipTarget = imergDataset.filterDate(startTarget, endTarget).mean().clip(UpperBasin).rename('precipitation_daily');
// Filter SMAP to our target month, calculate the mean, crop to basin, and rename the band
var smapTarget = smapMonthly.filterDate(startTarget, endTarget).mean().clip(UpperBasin).rename('soil_moisture_am');
// Filter MODIS to our target month, calculate the mean, crop to basin, and rename the band
var snowTarget = modisMonthly.filterDate(startTarget, endTarget).mean().clip(UpperBasin).rename('NDSI_Snow_Cover');

// Stack all the target month images into a single 5-band multi-layer image
var targetFloodImg = precipTarget.addBands(totalRunoffTarget).addBands(smapTarget).addBands(sweTarget).addBands(snowTarget);
// Select those exact same 5 bands from the climatology baseline image (required before subtraction)
var climFloodMatched = climFloodMon.select(['precipitation_daily', 'Total_Runoff_daily', 'soil_moisture_am', 'SWE_tavg', 'NDSI_Snow_Cover']);

// Mathematically subtract the Baseline pixel values from the Target pixel values to get Anomaly pixels
var FloodAnomaly = targetFloodImg.subtract(climFloodMatched)
                               .set('month', targetMonth)                   // Tag with the month
                               .set('year', targetYear)                     // Tag with the year
                               .set('system:time_start', startTarget.millis()); // Tag with timestamp

// ===================================================================================
// STEP 8: Extract Statistics and Visualize the Anomalies
// ===================================================================================
// Run a statistical mean across all the anomaly map pixels falling inside the Upper Basin
var basinMeanAnomalies = FloodAnomaly.reduceRegion({
  reducer: ee.Reducer.mean(), // Calculate average
  geometry: UpperBasin,       // Constrain to Upper Basin
  scale: 10000,               // Run at 10km resolution (matches native IMERG)
  maxPixels: 1e9              // Safety override for pixel limit
});
// Print the final, calculated single-number average anomalies for January 2025 to the console
print('Mean Anomalies for Lake Powell Watershed (January 2025):', basinMeanAnomalies);

// Add the Precipitation Anomaly to the map using a Red (dry), White (normal), Blue (wet) scale
Map.addLayer(FloodAnomaly.clip(Colorado), {bands: ['precipitation_daily'], min: -1, max: 1, palette: ['red', 'white', 'blue']}, 'Jan 2025 Precip Anomaly');
// Add the Runoff Anomaly to the map (hidden by default using 'false') with a tighter numerical scale
Map.addLayer(FloodAnomaly.clip(Colorado), {bands: ['Total_Runoff_daily'], min: -0.05, max: 0.05, palette: ['red', 'white', 'blue']}, 'Jan 2025 Runoff Anomaly', false); 
// Add the Soil Moisture Anomaly to the map (hidden by default) using small fraction scale (-0.1 to 0.1)
Map.addLayer(FloodAnomaly.clip(UpperBasin), {bands: ['soil_moisture_am'], min: -0.05, max: 0.05, palette: ['red', 'white', 'blue']}, 'Jan 2025 Soil Moisture Anomaly', false);
// Add the Snow Water Equivalent (SWE) Anomaly to the map (hidden by default) scaled from -50 to 50
Map.addLayer(FloodAnomaly.clip(UpperBasin), {bands: ['SWE_tavg'], min: -20, max: 20, palette: ['red', 'white', 'blue']}, 'Jan 2025 SWE Anomaly', false);
// Add the Snow Cover Percentage Anomaly to the map (hidden by default) scaled from -25% to 25%
Map.addLayer(FloodAnomaly.clip(UpperBasin), {bands: ['NDSI_Snow_Cover'], min: -15, max: 15, palette: ['red', 'white', 'blue']}, 'Jan 2025 Snow Cover Anomaly', false);

// ===================================================================================
// STEP 9: Create and Add a Map Legend
// ===================================================================================
// Create the main panel to hold the legend, positioned in the bottom-left corner
var legend = ui.Panel({
  style: {position: 'bottom-left', padding: '8px 15px', backgroundColor: 'rgba(255, 255, 255, 0.9)'}
});

// Create a title for the legend
var legendTitle = ui.Label({
  value: 'Monthly Anomaly (Target - Baseline)',
  style: {fontWeight: 'bold', fontSize: '14px', margin: '0 0 4px 0', padding: '0'}
});
legend.add(legendTitle);

// Create a subtitle explaining the general color scheme
var legendSubtitle = ui.Label({
  value: 'Applicable to Precip, Runoff, SM, SWE, and Snow Cover',
  style: {fontSize: '11px', color: 'gray', margin: '0 0 8px 0', padding: '0'}
});
legend.add(legendSubtitle);

// Define the exact color palette used in our Map.addLayer functions above
var visPalette = ['red', 'white', 'blue'];

// Create a function to generate a color bar thumbnail image
var makeColorBarParams = function(palette) {
  return {
    bbox: [0, 0, 1, 0.1], // Bounding box for the image
    dimensions: '200x15', // Width x Height of the color bar
    format: 'png',        // Image format
    min: 0,
    max: 1,
    palette: palette,     // Pass the red-white-blue palette
  };
};

// Create the physical color bar using an Earth Engine thumbnail and add it to the panel
var colorBar = ui.Thumbnail({
  image: ee.Image.pixelLonLat().select(0), // Creates a simple gradient image
  params: makeColorBarParams(visPalette),  // Applies the palette and dimensions
  style: {stretch: 'horizontal', margin: '0px 8px', maxHeight: '15px'}
});
legend.add(colorBar);

// Create a horizontal panel to hold the labels sitting exactly beneath the color bar
var legendLabels = ui.Panel({
  widgets: [
    ui.Label('Negative (-)', {margin: '4px 8px', fontSize: '12px'}), // Left label
    ui.Label('0 (Normal)', {margin: '4px 8px', fontSize: '12px', textAlign: 'center', stretch: 'horizontal'}), // Center label
    ui.Label('Positive (+)', {margin: '4px 8px', fontSize: '12px'})  // Right label
  ],
  layout: ui.Panel.Layout.flow('horizontal') // Display them side-by-side
});
legend.add(legendLabels);

// Add a tiny disclaimer note so participants know different layers use different math units
var legendNote = ui.Label({
  value: '*Note: See layer settings for specific numerical units.',
  style: {fontSize: '10px', color: 'gray', margin: '8px 0 0 0'}
});
legend.add(legendNote);

// Finally, push the completed legend UI panel to the main Map display
Map.add(legend);
