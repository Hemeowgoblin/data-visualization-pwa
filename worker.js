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
    const rateKey = 'Rate_%' in globalData[0] ? 'Rate_%' : 'Rate_Pct';

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
      if (yearComboCounts[year].size === targetCombinations) {
        validYears.push(parseInt(year));
      }
    }

    postMessage({ type: 'YEAR_INTERSECTION', years: validYears });
  }
  
  else if (msg.type === 'FILTER_BY_YEAR') {
    const { year, category, genders } = msg;

    // Filter by exact year, category, and active genders
    const payload = globalData.filter(d => 
      d.Year === year && 
      d.Category === category && 
      genders.includes(d.Gender)
    );
    
    postMessage({ type: 'FILTERED_DATA', year: year, payload });
  }
};
