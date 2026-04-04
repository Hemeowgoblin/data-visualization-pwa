let globalData = [];
// Map caching dimensions: category -> Set of Genders
let categoryGenderMap = {};
// Map caching Subsets: category -> Set of Subsets
let categorySubsetMap = {};

fetch('/unemployment_data.json')
  .then(res => res.json())
  .then(data => {
    globalData = data;
    
    // Build metadata dictionary
    data.forEach(row => {
      const { Category, Subset, Gender, Rate_Pct } = row;
      // We accept Rate_Pct or Rate_% based on pandas serialization
      const rateKey = 'Rate_%' in row ? 'Rate_%' : 'Rate_Pct';
      
      if (!categoryGenderMap[Category]) categoryGenderMap[Category] = new Set();
      if (!categorySubsetMap[Category]) categorySubsetMap[Category] = new Set();
      
      categoryGenderMap[Category].add(Gender);
      categorySubsetMap[Category].add(Subset);
    });
    
    postMessage({ type: 'DATA_LOADED', recordCount: data.length });
  })
  .catch(err => {
    console.error('Worker failed to load dataset:', err);
    postMessage({ type: 'ERROR', message: 'Failed to fetch unemployment_data.json' });
  });

onmessage = function(e) {
  const msg = e.data;
  
  if (msg.type === 'GET_METADATA') {
    // Convert Sets to arrays for serialization
    const payload = { categoryGenderMap: {}, categorySubsetMap: {} };
    for (let cat in categoryGenderMap) payload.categoryGenderMap[cat] = Array.from(categoryGenderMap[cat]);
    for (let cat in categorySubsetMap) payload.categorySubsetMap[cat] = Array.from(categorySubsetMap[cat]);
    
    postMessage({ type: 'METADATA', payload });
  } 
  
  else if (msg.type === 'CALCULATE_YEARS') {
    const { category, genders } = msg; // genders is an array of checked UI values
    const subsets = Array.from(categorySubsetMap[category] || []);
    
    if (subsets.length === 0 || genders.length === 0) {
      postMessage({ type: 'YEAR_INTERSECTION', years: [] });
      return;
    }

    // We must find years where EVERY required line has valid Rate_% data.
    // Required lines = EVERY Subset x EVERY checked Gender
    // Filter dataset to just this category and active genders
    const relevantData = globalData.filter(d => 
       d.Category === category && genders.includes(d.Gender)
    );

    // Build a map of Year -> Set of "Subset_Gender" combinations it has valid data for
    let yearComboCounts = {};
    const rateKey = (globalData && globalData.length > 0 && 'Rate_%' in globalData[0]) ? 'Rate_%' : 'Rate_Pct';

    // How many distinct combinations do we expect per year?
    const targetCombinations = subsets.length * genders.length;

    relevantData.forEach(d => {
      if (d[rateKey] !== null && d[rateKey] !== undefined) {
         if (!yearComboCounts[d.Year]) yearComboCounts[d.Year] = new Set();
         yearComboCounts[d.Year].add(`${d.Subset}_${d.Gender}`);
      }
    });

    // Valid years are those where the Set size === targetCombinations
    let validYears = [];
    for (let year in yearComboCounts) {
      if (yearComboCounts[year].size > 0) { // Tolerate missing/untracked demographics for specific years
        validYears.push(parseInt(year));
      }
    }

    postMessage({ type: 'YEAR_INTERSECTION', years: validYears });
  }
  
  else if (msg.type === 'GET_TREND_DATA') {
    const { startYear, endYear, category, genders } = msg;

    // Filter relevant dataset lines
    const lineData = globalData.filter(d => 
      d.Year >= startYear && d.Year <= endYear &&
      d.Category === category && 
      genders.includes(d.Gender)
    );

    // Always fetch general data for the toggle
    const generalData = globalData.filter(d => 
      d.Year >= startYear && d.Year <= endYear &&
      d.Category === 'General' &&
      d.Subset === 'Total 16+' &&
      d.Gender === 'Combined'
    );

    postMessage({ type: 'TREND_DATA', payload: { lineData, generalData }});
  }

  else if (msg.type === 'FILTER_BY_YEAR') {
    const { year, category, genders } = msg;

    const snapshotData = globalData.filter(d => 
      d.Year === year && 
      d.Category === category && 
      genders.includes(d.Gender)
    );

    const rateKey = (globalData && globalData.length > 0 && 'Rate_%' in globalData[0]) ? 'Rate_%' : 'Rate_Pct';
    const processedSnapshot = snapshotData.map(point => {
      const rawRate = point[rateKey];
      return {
        ...point,
        Rate: (rawRate !== null && rawRate !== undefined) ? Number(rawRate) : null,
        UnemployedLevel: point['Unemployed_Level'] !== null ? Number(point['Unemployed_Level']) : null,
        PercentOfCategory: point['Unemployed_Percent_Of_Category'] !== null ? Number(point['Unemployed_Percent_Of_Category']) : null
      };
    });
    
    postMessage({ type: 'FILTERED_DATA', year: year, payload: processedSnapshot });
  }
};
