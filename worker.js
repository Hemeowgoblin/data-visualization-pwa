import { CATEGORIES, AGE_COMPARISON_SUBSETS } from './constants.js';

let globalData = [];

// Initialize data loading
fetch('unemployment_data.json')
  .then(res => res.text())
  .then(text => {
    // Economic data from FRED often contains NaN for missing values in JSON-like formats.
    // JSON standard doesn't support NaN. Replace with null to allow parsing.
    const cleaned = text.replace(/:\s*NaN/g, ':null');
    try {
      globalData = JSON.parse(cleaned);
      console.log('Worker: Data loaded, count:', globalData.length);
      postMessage({ type: 'DATA_LOADED', recordCount: globalData.length });
    } catch (e) {
      console.error('Worker: JSON parse error after cleaning:', e.message);
      // Backup cleaning if first one failed
      const saferCleaned = text.replace(/NaN/g, 'null');
      globalData = JSON.parse(saferCleaned);
      postMessage({ type: 'DATA_LOADED', recordCount: globalData.length });
    }
  })
  .catch(err => {
    console.error('Worker failed to load dataset:', err);
    postMessage({ type: 'ERROR', message: 'Failed to fetch or parse unemployment_data.json' });
  });

onmessage = function(e) {
  const msg = e.data;
  
  if (msg.type === 'CALCULATE_YEARS') {
    const { category, filters } = msg;
    console.log('Worker: CALCULATE_YEARS for cat:', category, 'filters:', filters);

    const matchingRows = globalData.filter(d => {
      if (!d[category] || d[category].toString().toLowerCase() === "all") return false;
      if (category === 'age' && !AGE_COMPARISON_SUBSETS.includes(d[category])) return false;
      if (category === 'veteran_status' && d[category] === 'Veterans') return false;

      for (const catId in filters) {
        if (catId === category) continue;
        const targetVal = filters[catId];
        const rowVal = d[catId];
        
        if (targetVal === undefined) continue;
        if (!rowVal) return false; 

        if (rowVal.toString().toLowerCase() !== targetVal.toString().toLowerCase()) return false;
      }
      return true;
    });

    console.log('Worker: Matching rows found:', matchingRows.length);
    if (matchingRows.length === 0) {
        // Log one example row and why it failed for debugging
        const sample = globalData[0];
        console.log('Worker Debug: Sample row fails filter because...', {
            row: sample,
            filters: filters,
            cat: category
        });
    }

    const counts = {}; 
    let isUnique = true;
    
    matchingRows.forEach(d => {
      const key = `${d.year}_${d[category]}`;
      counts[key] = (counts[key] || 0) + 1;
      if (counts[key] > 1) isUnique = false;
    });

    const years = [...new Set(matchingRows.map(d => d.year))].sort((a,b) => a-b);
    postMessage({ type: 'YEAR_INTERSECTION', years, isUnique });
  }
  
  else if (msg.type === 'GET_TREND_DATA') {
    const { startYear, endYear, category, filters } = msg;

    const lineData = globalData.filter(d => 
      d.year >= startYear && d.year <= endYear &&
      d[category] && d[category].toLowerCase() !== "all" &&
      (!filters || Object.keys(filters).every(catId => {
          if (catId === category) return true;
          if (!d[catId]) return false;
          return d[catId].toString().toLowerCase() === filters[catId].toString().toLowerCase();
      }))
    ).filter(d => {
       if (category === 'age' && !AGE_COMPARISON_SUBSETS.includes(d[category])) return false;
       if (category === 'veteran_status' && d[category] === 'Veterans') return false;
       return true;
    });

    // Baseline: everything is "All" (high level aggregate)
    const generalData = globalData.filter(d => 
      d.year >= startYear && d.year <= endYear &&
      CATEGORIES.every(cat => d[cat.id] && d[cat.id].toLowerCase() === "all")
    );

    // Compute which years have full level data for all subsets (pie chart requires level > 0)
    const subsets = [...new Set(lineData.map(d => d[category]).filter(Boolean))];
    const yearLevelMap = {};
    lineData.forEach(d => {
      if (!yearLevelMap[d.year]) yearLevelMap[d.year] = {};
      yearLevelMap[d.year][d[category]] = d.level;
    });
    const pieYears = Object.keys(yearLevelMap)
      .map(Number)
      .filter(yr => subsets.every(s => yearLevelMap[yr][s] !== null && yearLevelMap[yr][s] !== undefined && yearLevelMap[yr][s] > 0));

    postMessage({ type: 'TREND_DATA', payload: { lineData, generalData, pieYears }});
  }

  else if (msg.type === 'FILTER_BY_YEAR') {
    const { year, category, filters } = msg;

    const snapshotData = globalData.filter(d => 
      d.year === year && 
      d[category] && d[category].toLowerCase() !== "all" &&
      (!filters || Object.keys(filters).every(catId => {
          if (catId === category) return true;
          if (!d[catId]) return false;
          return d[catId].toString().toLowerCase() === filters[catId].toString().toLowerCase();
      }))
    ).filter(d => {
       if (category === 'age' && !AGE_COMPARISON_SUBSETS.includes(d[category])) return false;
       if (category === 'veteran_status' && d[category] === 'Veterans') return false;
       return true;
    });

    const processedSnapshot = snapshotData.map(point => ({
      ...point,
      Subset: point[category],
      Rate: point.rate,
      UnemployedLevel: point.level,
      PercentOfCategory: point.percent_of_group
    }));
    
    postMessage({ type: 'FILTERED_DATA', year: year, payload: processedSnapshot });
  }

  else if (msg.type === 'VALIDATE_SUBFILTERS') {
    const { filters, nextCategoryId, comparisonCategory } = msg;
    
    const validSubsets = new Set();
    
    globalData.forEach(d => {
      // 1. Check if matches all filters in the chain so far
      for (const catId in filters) {
        if (!d[catId]) return;
        if (d[catId].toString().toLowerCase() !== filters[catId].toString().toLowerCase()) return;
      }

      // 2. Must also have a valid (non-All) value for the comparison parameter
      if (comparisonCategory) {
        const compVal = d[comparisonCategory];
        if (!compVal || compVal.toLowerCase() === 'all') return;
        if (comparisonCategory === 'age' && !AGE_COMPARISON_SUBSETS.includes(compVal)) return;
        if (comparisonCategory === 'veteran_status' && compVal === 'Veterans') return;
      }
      
      // 3. If it passes, the value at nextCategoryId is a valid option
      if (d[nextCategoryId]) {
        validSubsets.add(d[nextCategoryId]);
      }
    });
    
    postMessage({ type: 'VALID_SUBFILTERS', categoryId: nextCategoryId, validSubsets: Array.from(validSubsets) });
  }
};
