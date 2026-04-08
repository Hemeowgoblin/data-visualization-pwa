let globalData = [];
// Map caching dimensions: category -> Set of Genders
let categoryGenderMap = {};
// Map caching Subsets: category -> Set of series_descriptions
let categorySubsetMap = {};

fetch('unemployment_data.json')
  .then(res => res.json())
  .then(data => {
    globalData = data;
    
    // Build metadata dictionary
    // We'll iterate over all records to find distinct Genders per dimension category.
    // Dimensions: age, disability, race, industry_and_class, educational_attainment, 
    //             occupation, veteran_status, period_of_service, nativity.
    
    const dimensions = [
      "age", "disability", "race", "industry_and_class", "educational_attainment", 
      "occupation", "veteran_status", "period_of_service", "nativity"
    ];

    data.forEach(row => {
      dimensions.forEach(dim => {
        const dimVal = row[dim];
        if (dimVal && dimVal !== "All") {
          // This row belongs to 'dim' category
          if (!categoryGenderMap[dim]) categoryGenderMap[dim] = new Set();
          if (!categorySubsetMap[dim]) categorySubsetMap[dim] = new Set();
          
          categoryGenderMap[dim].add(row.gender);
          categorySubsetMap[dim].add(row.series_description);
        }
      });
      
      // Fallback for 'General' or baseline rows if needed
      if (!categoryGenderMap["general"]) categoryGenderMap["general"] = new Set();
      categoryGenderMap["general"].add(row.gender);
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
    const payload = { categoryGenderMap: {}, categorySubsetMap: {} };
    for (let cat in categoryGenderMap) payload.categoryGenderMap[cat] = Array.from(categoryGenderMap[cat]);
    for (let cat in categorySubsetMap) payload.categorySubsetMap[cat] = Array.from(categorySubsetMap[cat]);
    
    postMessage({ type: 'METADATA', payload });
  } 
  
  else if (msg.type === 'CALCULATE_YEARS') {
    const { category, genders } = msg;

    // Filter relevant lines: dimension column 'category' is not "All" + all others ARE "All"
    const relevantData = globalData.filter(d => {
      const matchGender = genders.includes(d.gender);
      if (!matchGender) return false;
      
      // Categorical rows have exactly one label column that isn't "All"
      if (category === 'general') {
        return d.age === "All" && d.race === "All"; // basic check for baseline
      }
      
      return d[category] !== "All";
    });

    let yearComboCounts = {};
    relevantData.forEach(d => {
      if (d.rate !== null && d.rate !== undefined) {
         if (!yearComboCounts[d.year]) yearComboCounts[d.year] = new Set();
         yearComboCounts[d.year].add(`${d.series_description}_${d.gender}`);
      }
    });

    let validYears = [];
    for (let year in yearComboCounts) {
      if (yearComboCounts[year].size > 0) {
        validYears.push(parseInt(year));
      }
    }

    postMessage({ type: 'YEAR_INTERSECTION', years: validYears });
  }
  
  else if (msg.type === 'GET_TREND_DATA') {
    const { startYear, endYear, category, genders } = msg;

    const lineData = globalData.filter(d => 
      d.year >= startYear && d.year <= endYear &&
      d[category] !== "All" &&
      genders.includes(d.gender)
    );

    // Fetch baseline data (where everything is "All")
    const generalData = globalData.filter(d => 
      d.year >= startYear && d.year <= endYear &&
      d.gender === "All" &&
      d.age === "All" && d.race === "All" && d.disability === "All" && 
      d.educational_attainment === "All" && d.occupation === "All" && 
      d.nature === "All" && d.industry_and_class === "All" &&
      d.series_description.includes("All/All/All/All/All/All/All/All/All/All")
    );

    postMessage({ type: 'TREND_DATA', payload: { lineData, generalData }});
  }

  else if (msg.type === 'FILTER_BY_YEAR') {
    const { year, category, genders } = msg;

    const snapshotData = globalData.filter(d => 
      d.year === year && 
      d[category] !== "All" &&
      genders.includes(d.gender)
    );

    const processedSnapshot = snapshotData.map(point => {
      return {
        ...point,
        Subset: point.series_description,
        Rate: point.rate,
        UnemployedLevel: point.level,
        PercentOfCategory: point.percent_of_group
      };
    });
    
    postMessage({ type: 'FILTERED_DATA', year: year, payload: processedSnapshot });
  }
};
