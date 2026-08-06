/*                      
======================================================================================================
ARSET Training: NASA Earth Observations for Reservoir and Water Utility Management
Date: 6 August 2026
Training Website: https://www.earthdata.nasa.gov/learn/trainings/nasa-earth-observations-reservoir-water-utility-management
Demonstration: Runoff, Precipitation, and Soil Moisture for the Lake Itaipu Watershed 
Datasets: GLDAS (Runoff), GPM IMERG (Precipitation), and SMAP Level 3 (Soil Moisture)
Authors: Amita Mehta, Sean McCartney
------------------------------------------------------------------------------------------------------
Script Description: 
This script uses the Lake Itaipu watershed as a case study to demonstrate how to:
  1. Define a watershed boundary (HydroBASINS) and load reference water bodies (GLOBathy).
  2. Access multi-sensor data representing the full hydrological cycle:
     - Precipitation (GPM IMERG)
     - Surface Soil Moisture (SMAP Level 3, merging V5 and V6)
     - Runoff (GLDAS)
  3. Generate a 10-year (2016-2026) monthly mean climatology to observe long-term seasonal trends.
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
Every effort is made to ensure the code is free of errors but there is no warranty for the maps 
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
   We use Level 4 to capture the large regional Parana River Basin that feeds Lake Itaipu.
   
   PRO-TIP: HOW TO FIND OTHER BASINS
   1. Turn on the 'HydroSHEDS' layer via the Layers menu (top right of the map).
   2. Click the 'Inspector' tab in the top-right console.
   3. Click any watershed polygon on the map. 
   4. Expand the feature's properties in the Inspector to find its unique 'HYBAS_ID'.
*/
 var basins = ee.FeatureCollection('WWF/HydroSHEDS/v1/Basins/hybas_4'); 
 var Parana = basins.filter(ee.Filter.eq('HYBAS_ID', 6040814830)); // Isolate Lake Itaipu

// Center the map on Lake Itaipu and set the basemap to 'TERRAIN' for topographic context.
Map.setCenter(-53.3, -24.4, 7);
Map.setOptions('TERRAIN'); 

// Create a hollow styling for the basin boundary so we can see the raster data underneath.
// The hex code '00000000' is used: the last two zeros set the opacity to 0% (fully transparent).
var Pbasin = Parana.style({
  color: 'gray',          
  fillColor: '00000000',  
  width: 2                
});

// Add the full HydroSHEDS layer (hidden by default) and the specific Itaipu Basin boundary.
Map.addLayer(basins, {}, 'HydroSHEDS (Global)', false); 
Map.addLayer(Pbasin, {}, 'Selected Basin: Lake Itaipu Watershed');

// Overlay global lake bathymetry data (GLOBathy) to provide geographic context.
// This helps users visually locate Lake Itaipu and surrounding water bodies.
var globathy = ee.Image("projects/sat-io/open-datasets/GLOBathy/GLOBathy_bathymetry");
var basinLakes = globathy.clip(Parana);
Map.addLayer(basinLakes, {palette: ['white']}, "Water Bodies (Lakes)");


// ===================================================================================
// STEP 2: Access and Filter Multi-Sensor Data
// ===================================================================================
// Define the 10-year climatology period (2016 to 2026).
var startClim = '2016-01-01';
var endClim   = '2026-01-01'; 
var smapTransitionDate = '2023-12-04'; // Transition date from SMAP V5 to V6

// Dataset 1: GLDAS version 2.2 (Daily Runoff at 0.25 degree resolution)
// Filtering by bounds early prevents GEE from processing global data, saving memory.
var gldasDataset = ee.ImageCollection('NASA/GLDAS/V022/CLSM/G025/DA1D')
                     .filterDate(startClim, endClim)
                     .filterBounds(Parana) 
                     .select(['Qs_tavg','Qsb_tavg']); // Qs = Surface Runoff, Qsb = Baseflow

// Dataset 2: GPM IMERG Monthly Level 3 Version 7 (~11 km resolution Precipitation)
var imergDataset = ee.ImageCollection('NASA/GPM_L3/IMERG_MONTHLY_V07')
                     .filterDate(startClim, endClim)
                     .filterBounds(Parana)
                     .select('precipitation');

// Dataset 3: SMAP Level 3 Enhanced (Daily Surface Soil Moisture at 9 km resolution)
// SMAP Version 5 processing ended on Dec 4, 2023. Version 6 handles data after this date. 
// We merge both collections below to ensure a continuous dataset for our 10-year timeframe. 
// Note: 'soil_moisture_am' (~6:00 AM overpass) is used because soil and vegetation 
// are typically in thermal equilibrium in the morning, yielding more accurate readings.
var smapV5 = ee.ImageCollection('NASA/SMAP/SPL3SMP_E/005')
               .filterDate(startClim, smapTransitionDate)
               .filterBounds(Parana)
               .select('soil_moisture_am');

var smapV6 = ee.ImageCollection('NASA/SMAP/SPL3SMP_E/006')
               .filterDate(smapTransitionDate, endClim)
               .filterBounds(Parana)
               .select('soil_moisture_am');

// Combine the historical V5 and newer V6 data into one continuous collection.
var smapDataset = smapV5.merge(smapV6);


// ===================================================================================
// STEP 3: Calculate the Monthly Mean Climatology
// ===================================================================================
/*
   GEE CONCEPT: In Earth Engine, standard 'for' loops run on the client side and are 
   inefficient for image processing. Instead, we create a list (1-12) and use `.map()` 
   to apply our averaging functions across Google's servers in parallel.
*/
// Create a sequential list of integers representing the 12 calendar months.
var months = ee.List.sequence(1, 12);

// Map over the list to calculate the 10-year mean for each specific month.
var monthlyClimatology = ee.ImageCollection.fromImages(
  months.map(function(m) {
    
    // -- Process Runoff --
    var runoffMonth = gldasDataset.filter(ee.Filter.calendarRange(m, m, 'month')).mean();
    
    // -- Process Precipitation --
    /* 
       HYDROLOGY CONCEPT: IMERG Monthly natively provides an average rainfall rate in mm/hr.
       We multiply by 24 (hours) to convert this to an average daily rate (mm/day).
    */
    var precipMonth = imergDataset.filter(ee.Filter.calendarRange(m, m, 'month'))
                                  .mean().multiply(24).rename('precipitation_daily');

    // -- Process Soil Moisture --
    // Volumetric soil moisture (m^3/m^3) requires no mathematical conversion.
    var smapMonth = smapDataset.filter(ee.Filter.calendarRange(m, m, 'month')).mean();

    // Combine Runoff, Precip, and SMAP into a single multi-band image for this month.
    // The `.set('month', m)` tags the image with metadata so we can organize it later.
    return runoffMonth.addBands(precipMonth)
                      .addBands(smapMonth)
                      .set('month', m);
  })
);


// ===================================================================================
// STEP 4: Clip to Watershed and Standardize Runoff Units
// ===================================================================================
/*
   GEE CONCEPT: We wait to clip the data until the very end. Clipping 12 monthly 
   averages is computationally much faster than clipping thousands of daily raw images.
*/
var clim_watershed = monthlyClimatology.map(function(img) {
  var clipped = img.clip(Parana);
  
  /* 
     HYDROLOGY CONCEPT: GLDAS runoff is natively provided as a flux rate: kg/m^2/s.
     Because 1 kg of water spread over 1 square meter is equal to 1 millimeter in depth,
     we multiply by 86,400 (the total seconds in a 24-hour day) to convert to mm/day.
  */
  var surfaceRunoff = clipped.select('Qs_tavg').multiply(86400);
  var baseFlow = clipped.select('Qsb_tavg').multiply(86400);
  
  // Add surface runoff and sub-surface baseflow together to calculate Total Runoff.
  var totalRunoff = surfaceRunoff.add(baseFlow).rename('Total_Runoff_daily');
  
  // Return the clipped image with the new standardized Total Runoff band appended.
  return clipped.addBands(totalRunoff);             
});


// ===================================================================================
// STEP 5: Map Visualization (Looping through 12 months)
// ===================================================================================
// Define visualization parameters: min/max data stretches and color palettes.
var visParamsRunoff = {min: 0, max: 5, palette: ['blue', 'green', 'yellow', 'orange', 'red']}; 
var visParamsPrecip = {min: 0, max: 10, palette: ['white', 'blue', 'cyan', 'green', 'yellow', 'red']}; 
var visParamsSM = {min: 0, max: 0.5, palette: ['8B4513', 'FFD700', '00FF00', '0000FF']}; // Brown (dry) to Blue (wet)

/* 
   MEMORY MANAGEMENT: We loop through the 12 months and load them into the "Layers" tab.
   By setting the visibility flag to 'false' in Map.addLayer, we prevent the browser 
   from trying to render all 36 layers simultaneously (which would cause a crash). 
   Users can manually toggle specific months on and off via the UI Layers tab.
*/
for (var i = 1; i <= 12; i++) {
  var monthImg = clim_watershed.filter(ee.Filter.eq('month', i)).first();

  Map.addLayer(
    monthImg.select('soil_moisture_am'), 
    visParamsSM, 
    'Month ' + i + ' - Mean Surface SM (AM)', 
    false 
  );

  Map.addLayer(
    monthImg.select('precipitation_daily'), 
    visParamsPrecip, 
    'Month ' + i + ' - Average Daily Precip Rate', 
    false 
  );

  Map.addLayer(
    monthImg.select('Total_Runoff_daily'), 
    visParamsRunoff, 
    'Month ' + i + ' - Mean Total Runoff', 
    false                           
  );
}


// ===================================================================================
// STEP 6: Add Legends to the UI
// ===================================================================================
/*
   GEE CONCEPT: The User Interface (ui) API allows us to build custom widgets.
   Below, we define a helper function that takes a variable title, its visualization 
   parameters, and its units, and returns a formatted legend panel with a color bar.
*/
function createLegend(title, visParams, units) {
  // Create a container panel for the individual legend
  var legend = ui.Panel({
    style: { padding: '8px 15px', position: 'bottom-right', backgroundColor: 'rgba(255, 255, 255, 0.9)' }
  });

  // Create and add the Legend Title
  var legendTitle = ui.Label({
    value: title + ' (' + units + ')',
    style: { fontWeight: 'bold', fontSize: '14px', margin: '0 0 4px 0', padding: '0' }
  });
  legend.add(legendTitle);

  // Define parameters to generate the color bar image based on the palette
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
  
  // Create the color bar using ui.Thumbnail and pixelLonLat
  var colorBar = ui.Thumbnail({
    image: ee.Image.pixelLonLat().select(0),
    params: makeColorBarParams(visParams.palette),
    style: { stretch: 'horizontal', margin: '0px 8px', maxHeight: '24px' },
  });

  // Create labels for the Minimum, Middle, and Maximum values
  var legendLabels = ui.Panel({
    widgets: [
      ui.Label(visParams.min, {margin: '4px 8px'}),
      ui.Label((visParams.max / 2), {margin: '4px 8px', textAlign: 'center', stretch: 'horizontal'}),
      ui.Label(visParams.max, {margin: '4px 8px'})
    ],
    layout: ui.Panel.Layout.flow('horizontal')
  });

  // Assemble the panel
  legend.add(colorBar);
  legend.add(legendLabels);
  return legend;
}

// Create a master panel to hold all the individual variable legends
var masterLegendPanel = ui.Panel({
  style: { position: 'bottom-left', padding: '8px', backgroundColor: 'white', border: '1px solid black' }
});

// Add a main title for the master legend panel
masterLegendPanel.add(ui.Label('Variable Legends', {fontWeight: 'bold', fontSize: '16px', margin: '0 0 10px 0'}));

// Add the individual legends to the master panel
masterLegendPanel.add(createLegend('Precipitation', visParamsPrecip, 'mm/day'));
masterLegendPanel.add(createLegend('Soil Moisture', visParamsSM, 'm³/m³'));
masterLegendPanel.add(createLegend('Runoff', visParamsRunoff, 'mm/day'));

// Finally, add the master legend panel to the Map UI
Map.add(masterLegendPanel);

// ===================================================================================
// End of Script
// ===================================================================================
