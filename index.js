import './index.css';
import Chart from 'chart.js/auto';
import { pack, hierarchy } from 'd3-hierarchy';
import { CATEGORIES, AGE_COMPARISON_SUBSETS } from './constants.js';

console.log('Main thread initializing.');

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

// UI Elements
const flowContainer = document.getElementById('flowContainer');
const subjectSelect = document.getElementById('subjectSelect');
const parameterSelect = document.getElementById('parameterSelect');
const filtersArea = document.getElementById('filtersArea');
const dynamicFiltersContainer = document.getElementById('dynamicFiltersContainer');
const confirmChoicesBtn = document.getElementById('confirmChoicesBtn');
const dateSelectionArea = document.getElementById('dateSelectionArea');
const startYearSelect = document.getElementById('startYearSelect');
const endYearSelect = document.getElementById('endYearSelect');
const generateVizBtn = document.getElementById('generateVizBtn');
const blockVisuals = document.getElementById('blockVisuals');

const resetSelectionsBtn = document.getElementById('resetSelectionsBtn');
const yearSlider = document.getElementById('yearSlider');
const currentYearDisplay = document.getElementById('currentYearDisplay');

const generalTrendToggle = document.getElementById('generalTrendToggle');
const chartTypeRadios = document.getElementsByName('chartType');

// Chart global instances
let trendChart = null;
let snapshotChart = null;
let currentTrendData = [];
let currentGeneralData = [];
let currentSnapshotData = [];

let activeColorMap = {};
let globalMetadata = null; 
let currentValidYears = [];
let currentStartYear = 1948;
let currentEndYear = 2026;

// New state for multi-dimensional filtering
let activeFilters = {}; // { categoryId: selectedSubfilter }

// Custom plugin for drawing the vertical scrubber line on the trend chart
const verticalLinePlugin = {
  id: 'verticalLine',
  afterDraw: (chart) => {
    if (!chart.scales || !chart.scales.x || !chart.scales.y) return;
    
    const activeYearStr = currentYearDisplay.textContent;
    if (!activeYearStr || isNaN(parseInt(activeYearStr))) return;
    
    const xAxis = chart.scales.x;
    const yAxis = chart.scales.y;
    const xVal = parseInt(activeYearStr);
    
    if (xVal >= xAxis.min && xVal <= xAxis.max) {
      const xPixel = xAxis.getPixelForValue(xVal);
      const ctx = chart.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(xPixel, yAxis.top);
      ctx.lineTo(xPixel, yAxis.bottom);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.restore();
    }
  }
};
Chart.register(verticalLinePlugin);

worker.onmessage = (e) => {
  const data = e.data;
  if (data.type === 'DATA_LOADED') {
    // Already populated immediately
  } else if (data.type === 'YEAR_INTERSECTION') {
    currentValidYears = data.years;
    populateYearDropdowns(currentValidYears, data.isUnique);
  } else if (data.type === 'TREND_DATA') {
    currentTrendData = data.payload.lineData;
    currentGeneralData = data.payload.generalData;
    renderTrendChart();
    renderSliderMarkers(data.payload.pieYears || []);
  } else if (data.type === 'FILTERED_DATA') {
    currentSnapshotData = data.payload;
    renderSnapshotChart();
  } else if (data.type === 'VALID_SUBFILTERS') {
    handleValidSubfilters(data.categoryId, data.validSubsets);
  }
};

function populateParameterSelect() {
  parameterSelect.innerHTML = '<option value="" disabled selected>Select parameter...</option>';
  CATEGORIES.forEach(cat => {
    const opt = new Option(cat.label, cat.id);
    parameterSelect.add(opt);
  });
}

/* --- Wizard Setup --- */
subjectSelect.addEventListener('change', () => { parameterSelect.disabled = false; });

parameterSelect.addEventListener('change', (e) => {
  const category = e.target.value;
  buildFilters(category);
});

// Populate immediately as CATEGORIES is available via import
populateParameterSelect();

function buildFilters(selectedCategory) {
  dynamicFiltersContainer.innerHTML = '';
  filtersArea.classList.remove('hidden');
  
  activeFilters = {};
  
  // Create a filter group for each category except the comparison parameter
  CATEGORIES.filter(cat => cat.id !== selectedCategory).forEach(cat => {
    const groupEl = document.createElement('div');
    groupEl.className = 'filter-group';
    groupEl.id = `group-${cat.id}`;
    groupEl.innerHTML = `<div class="filter-group-title">${cat.label}</div><div class="chips-list" id="chips-${cat.id}"></div>`;
    dynamicFiltersContainer.appendChild(groupEl);
    
    const chipsContainer = groupEl.querySelector('.chips-list');
    
    cat.subsets.forEach(subset => {
      const label = document.createElement('label');
      label.className = 'chip-label';
      label.innerHTML = `
        <input type="radio" name="filter-${cat.id}" class="chip-radio filter-radio" value="${subset}">
        <span>${subset}</span>
      `;
      chipsContainer.appendChild(label);
      
      const input = label.querySelector('input');
      input.addEventListener('change', () => handleFilterChange(cat.id, subset));
    });

    // Default to the rightmost option ("All")
    const radios = chipsContainer.querySelectorAll('input');
    const defaultRadio = radios[radios.length - 1];
    defaultRadio.checked = true;
    activeFilters[cat.id] = defaultRadio.value;
  });

  validateConfirmButton();
  // Trigger initial validation for the first filter in sequence
  const remainingCats = CATEGORIES.filter(cat => cat.id !== selectedCategory);
  if (remainingCats.length > 0) {
    updateSequentialValidation(0);
  }
}

function handleFilterChange(categoryId, value) {
  activeFilters[categoryId] = value;
  
  // Trigger sequential validation for all filters BELOW this one
  const selectedCategory = parameterSelect.value;
  const remainingCats = CATEGORIES.filter(cat => cat.id !== selectedCategory);
  const index = remainingCats.findIndex(cat => cat.id === categoryId);
  
  if (index !== -1) {
    updateSequentialValidation(index + 1);
  }
  
  validateConfirmButton();
}

function updateSequentialValidation(startIndex) {
  const selectedCategory = parameterSelect.value;
  const remainingCats = CATEGORIES.filter(cat => cat.id !== selectedCategory);
  
  if (startIndex >= remainingCats.length) return;
  
  const nextCat = remainingCats[startIndex];
  
  // We need to check which subsets of nextCat are valid GIVEN current selections for 0..startIndex-1
  const currentSelections = {};
  for (let i = 0; i < startIndex; i++) {
    const catId = remainingCats[i].id;
    currentSelections[catId] = activeFilters[catId];
  }
  
  worker.postMessage({
    type: 'VALIDATE_SUBFILTERS',
    filters: currentSelections,
    nextCategoryId: nextCat.id,
    comparisonCategory: selectedCategory
  });
}

function handleValidSubfilters(categoryId, validSubsets) {
  const container = document.getElementById(`chips-${categoryId}`);
  if (!container) return;
  
  const labels = container.querySelectorAll('.chip-label');
  labels.forEach(label => {
    const radio = label.querySelector('input');
    const value = radio.value;
    
    if (validSubsets.some(s => s.toLowerCase() === value.toLowerCase())) {
      label.classList.remove('disabled');
      radio.disabled = false;
    } else {
      label.classList.add('disabled');
      radio.disabled = true;
    }
  });
  
  // After validating this one, move to the next in sequence
  const selectedCategory = parameterSelect.value;
  const remainingCats = CATEGORIES.filter(cat => cat.id !== selectedCategory);
  const currentIndex = remainingCats.findIndex(cat => cat.id === categoryId);
  if (currentIndex !== -1 && currentIndex < remainingCats.length - 1) {
    updateSequentialValidation(currentIndex + 1);
  }
}


function validateConfirmButton() {
    // Confirm button is enabled if a parameter is selected and all active filters have a choice (they do because of defaults)
    if (parameterSelect.value) {
        confirmChoicesBtn.classList.remove('disabled');
        confirmChoicesBtn.disabled = false;
        confirmChoicesBtn.style.opacity = '1';
        confirmChoicesBtn.style.pointerEvents = 'auto';
    } else {
        confirmChoicesBtn.classList.add('disabled');
        confirmChoicesBtn.disabled = true;
    }
}


/* --- Transitions --- */
confirmChoicesBtn.addEventListener('click', () => {
  if (confirmChoicesBtn.textContent === 'Edit Choices') {
    flowContainer.className = 'flow-container state-setup';
    dateSelectionArea.classList.add('hidden');
    blockVisuals.classList.add('hidden');
    confirmChoicesBtn.textContent = 'Confirm Choices';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  flowContainer.className = 'flow-container state-confirmed';
  
  const selectedCategory = parameterSelect.value;
  confirmChoicesBtn.textContent = 'Edit Choices';
  dateSelectionArea.classList.remove('hidden');

  worker.postMessage({
    type: 'CALCULATE_YEARS',
    category: selectedCategory,
    filters: activeFilters
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
});

function populateYearDropdowns(years, isUnique = true) {
  startYearSelect.innerHTML = '';
  endYearSelect.innerHTML = '';
  
  if (years.length === 0 || !isUnique) {
    startYearSelect.innerHTML = '<option disabled>No unique data series found...</option>';
    endYearSelect.innerHTML = '<option disabled>Please check filters...</option>';
    generateVizBtn.disabled = true;
    generateVizBtn.classList.add('disabled');
    generateVizBtn.innerText = isUnique ? "No Data for Range" : "Multiple Series Detected";
    return;
  }
  
  generateVizBtn.classList.remove('disabled');
  generateVizBtn.disabled = false;
  generateVizBtn.innerText = "Generate Visualization";

  years.sort((a,b) => a-b);
  years.forEach(y => {
    startYearSelect.add(new Option(y, y));
    endYearSelect.add(new Option(y, y));
  });
  
  startYearSelect.value = years[0];
  endYearSelect.value = years[years.length - 1];
}

generateVizBtn.addEventListener('click', () => {
  currentStartYear = parseInt(startYearSelect.value);
  currentEndYear = parseInt(endYearSelect.value);

  if (currentStartYear > currentEndYear) {
    alert("Start Year cannot be greater than End Year.");
    return;
  }

  flowContainer.className = 'flow-container state-visualized';
  blockVisuals.classList.remove('hidden');
  document.querySelectorAll('.chart-empty-state').forEach(el => el.classList.add('hidden'));

  yearSlider.min = currentStartYear;
  yearSlider.max = currentEndYear;
  yearSlider.value = currentStartYear;
  currentYearDisplay.textContent = currentStartYear;
  
  const selectedCategory = parameterSelect.value;
  worker.postMessage({
    type: 'GET_TREND_DATA',
    startYear: currentStartYear,
    endYear: currentEndYear,
    category: selectedCategory,
    filters: activeFilters
  });

  requestDataForYear(currentStartYear);

  window.scrollTo({ top: 0, behavior: 'smooth' });
});

/* --- Interactions --- */
resetSelectionsBtn.addEventListener('click', () => { location.reload(); });

yearSlider.addEventListener('input', (e) => {
  currentYearDisplay.textContent = e.target.value;
  requestDataForYear(parseInt(e.target.value));
  if (trendChart) trendChart.draw(); 
});

document.getElementById('prevYear').addEventListener('click', () => {
  let val = parseInt(yearSlider.value) - 1;
  if (val >= yearSlider.min) {
    yearSlider.value = val;
    currentYearDisplay.textContent = val;
    requestDataForYear(val);
    if (trendChart) trendChart.draw();
  }
});

document.getElementById('nextYear').addEventListener('click', () => {
  let val = parseInt(yearSlider.value) + 1;
  if (val <= yearSlider.max) {
    yearSlider.value = val;
    currentYearDisplay.textContent = val;
    requestDataForYear(val);
    if (trendChart) trendChart.draw();
  }
});

generalTrendToggle.addEventListener('change', () => {
  renderTrendChart();
});

chartTypeRadios.forEach(radio => {
  radio.addEventListener('change', (e) => {
    userPreferredChartType = e.target.value;
    renderSnapshotChart();
  });
});

function requestDataForYear(year) {
  worker.postMessage({ 
    type: 'FILTER_BY_YEAR',
    year: year,
    category: parameterSelect.value,
    filters: activeFilters
  });
}

/* --- Color Palettes --- */
function getPaletteColors() {
  // High-contrast, perceptually distinct palette — no green (reserved for General Trend), no red
  return [
    '#6366f1', // indigo
    '#06b6d4', // cyan
    '#eab308', // amber
    '#8b5cf6', // violet
    '#f97316', // orange
    '#0ea5e9', // sky blue
    '#a855f7', // purple
    '#fbbf24', // yellow
    '#14b8a6', // teal
    '#d946ef', // fuchsia
    '#fb923c', // light orange
    '#7dd3fc', // light blue
    '#c084fc', // light purple
    '#fdba74', // peach
    '#5eead4', // light teal
  ];
}

function buildColorMap(subsets) {
  activeColorMap = {};
  const palette = getPaletteColors();
  let colorIdx = 0;
  
  subsets.forEach(sub => {
    if (sub === 'Men') activeColorMap[sub] = '#3b82f6';
    else if (sub === 'Women') activeColorMap[sub] = '#ec4899';
    else {
      activeColorMap[sub] = palette[colorIdx % palette.length];
      colorIdx++;
    }
  });
}

/* --- Rendering Engines --- */
const getRate = (p) => {
  return (p.rate !== undefined && p.rate !== null) ? Number(p.rate) : null;
};

function renderTrendChart() {
  const ctx = document.getElementById('lineChartCanvas')?.getContext('2d');
  if (!ctx) return;
  if (trendChart) trendChart.destroy();

  const selectedCategory = parameterSelect.value;
  const subsets = [...new Set(currentTrendData.map(d => d[selectedCategory]).filter(Boolean))];
  buildColorMap(subsets);

  const datasets = subsets.map((sub) => {
    const linePoints = currentTrendData.filter(d => d[selectedCategory] === sub).sort((a,b) => a.year - b.year);
    const color = activeColorMap[sub];
    return {
      label: sub,
      data: linePoints.map(p => ({ x: p.year, y: getRate(p) })),
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 6
    };
  });

  if (generalTrendToggle.checked) {
    const generalPoints = currentGeneralData.sort((a,b) => a.year - b.year);
    datasets.push({
      label: 'General Trend',
      data: generalPoints.map(p => ({ x: p.year, y: getRate(p) })),
      borderColor: '#22c55e',
      backgroundColor: '#22c55e',
      borderWidth: 2,
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 6
    });
  }

  trendChart = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            usePointStyle: true,
            pointStyle: 'circle',
            padding: 16,
            generateLabels: (chart) => {
              return chart.data.datasets.map((ds, i) => {
                const isHidden = ds.hidden === true;
                return {
                  text: ds.label,
                  fillStyle: isHidden ? 'transparent' : ds.borderColor,
                  strokeStyle: ds.borderColor,
                  fontColor: ds.borderColor,
                  lineWidth: isHidden ? 2 : 0,
                  datasetIndex: i,
                  hidden: false, // never set true here; suppresses strikethrough
                };
              });
            }
          },
          onClick: (e, legendItem, legend) => {
            const ds = legend.chart.data.datasets[legendItem.datasetIndex];
            ds.hidden = !ds.hidden;
            legend.chart.update();
          }
        },
        tooltip: { enabled: false }
      },
      scales: {
        x: { 
          type: 'linear', 
          min: currentStartYear, 
          max: currentEndYear, 
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            color: '#a0a6b1',
            stepSize: (currentEndYear - currentStartYear) <= 10 ? 1
                    : (currentEndYear - currentStartYear) <= 30 ? 5 : 10,
            callback: val => Number.isInteger(val) ? val : null
          }
        },
        y: {
          title: { display: true, text: 'Unemployment Rate (%)', color: '#a0a6b1' },
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#a0a6b1', callback: val => val.toFixed(1) }
        }
      }
    }
  });
}

let userPreferredChartType = 'bar';

/* --- Slider Pie Gradient --- */
function renderSliderMarkers(pieYears) {
  const slider = document.getElementById('yearSlider');
  if (!slider) return;

  const min = currentStartYear;
  const max = currentEndYear;
  const BASE = 'rgba(14,22,38,0.85)';
  const PIE  = '#06b6d4';

  if (min >= max || pieYears.length === 0) {
    slider.style.background = BASE;
    return;
  }

  const sorted = [...pieYears].filter(y => y >= min && y <= max).sort((a, b) => a - b);
  if (sorted.length === 0) { slider.style.background = BASE; return; }

  const toFrac = y => Math.max(0, Math.min(1, (y - min) / (max - min)));
  const toPct  = f => (f * 100).toFixed(3) + '%';

  // Build consecutive run-segments (adjacent years → one block)
  const segs = [];
  let s = sorted[0], e = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === e + 1) { e = sorted[i]; }
    else { segs.push([s, e]); s = e = sorted[i]; }
  }
  segs.push([s, e]);

  // Build gradient stops for the full track
  const stops = [];
  let cursor = 0;
  for (const [segS, segE] of segs) {
    const f0 = toFrac(segS - 0.5);
    const f1 = toFrac(segE + 0.5);
    if (f0 > cursor) {
      stops.push(`${BASE} ${toPct(cursor)}`, `${BASE} ${toPct(f0)}`);
    }
    stops.push(`${PIE} ${toPct(f0)}`, `${PIE} ${toPct(f1)}`);
    cursor = f1;
  }
  if (cursor < 1) stops.push(`${BASE} ${toPct(cursor)}`, `${BASE} 100%`);

  slider.style.background = `linear-gradient(to right, ${stops.join(', ')})`;
}

function getGlobalMaxRate() {
  const allRates = [
    ...currentTrendData.map(d => getRate(d)),
    ...currentGeneralData.map(d => getRate(d))
  ].filter(v => v !== null && !isNaN(v));
  
  return allRates.length > 0 ? Math.max(...allRates) : 10;
}

function renderSnapshotChart() {
  const ctx = document.getElementById('mainChartCanvas').getContext('2d');
  if (snapshotChart) snapshotChart.destroy();

  const hasMissingData = currentSnapshotData.some(d => {
    return getRate(d) === null || d.level === null;
  });
  const chartTypeInputs = document.querySelectorAll('input[name="chartType"]');

  if (hasMissingData && currentSnapshotData.length > 0) {
    chartTypeInputs.forEach(r => {
      if (r.value !== 'bar') {
        r.disabled = true;
        r.parentElement.style.opacity = '0.4';
      } else {
        r.checked = true;
      }
    });
  } else {
    chartTypeInputs.forEach(r => {
      r.disabled = false;
      r.parentElement.style.opacity = '1';
      if (r.value === userPreferredChartType) r.checked = true;
    });
  }

  const activeRadio = document.querySelector('input[name="chartType"]:checked');
  if (!activeRadio) return;
  const activeType = activeRadio.value;

  const subtitleEl = document.getElementById('snapshotSubtitle');
  if (subtitleEl) {
    if (activeType === 'pie') subtitleEl.textContent = 'Unemployed People per Category to the Sum in All Categories';
    else if (activeType === 'bubble') subtitleEl.textContent = 'Number of Unemployed People per Category';
    else if (activeType === 'bar') subtitleEl.textContent = 'Unemployment Rate Within the Category';
  }

  const selectedCategory = parameterSelect.value;

  let data = [];
  if (activeType === 'bar') {
    data = [...currentSnapshotData].sort((a,b) => (a[selectedCategory] || '').localeCompare(b[selectedCategory] || ''));
  } else {
    data = [...currentSnapshotData].filter(d => getRate(d) > 0).sort((a, b) => b.rate - a.rate);
  }
  
  const emptyStateEl = document.querySelector('#mainChartContainer .chart-empty-state');
  const canvasEl = document.getElementById('mainChartCanvas');

  if (data.length === 0) {
    emptyStateEl.textContent = 'No data available.';
    emptyStateEl.classList.remove('hidden');
    canvasEl.style.opacity = '0';
  } else {
    emptyStateEl.classList.add('hidden');
    canvasEl.style.opacity = '1';
  }

  let labels = data.map(d => d[selectedCategory] || d.series_description);
  const bgColors = data.map(d => activeColorMap[d[selectedCategory]] || activeColorMap[d.series_description] || '#64748b');

  if (activeType === 'bar') {
    const globalMax = getGlobalMaxRate();
    snapshotChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Unemployment Rate (%)',
          data: data.map(d => getRate(d)),
          backgroundColor: bgColors,
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { display: false, min: 0, max: globalMax * 1.2 },
          y: { grid: { display: false }, ticks: { color: '#f2f4f7', font: { size: 12, weight: 'bold' } } }
        }
      },
      plugins: [{
        id: 'barLabels',
        afterDatasetsDraw: (chart) => {
          const { ctx, data } = chart;
          chart.getDatasetMeta(0).data.forEach((bar, index) => {
            const rawVal = data.datasets[0].data[index];
            const label = (rawVal !== null && rawVal > 0) ? `${rawVal.toFixed(1)}%` : "N/A";
            const color = data.datasets[0].backgroundColor[index];
            ctx.save();
            ctx.fillStyle = color;
            ctx.font = 'bold 12px Inter';
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.fillText(label, Math.max(bar.x, bar.base) + 12, bar.y);
            ctx.restore();
          });
        }
      }]
    });
  } 
  else if (activeType === 'pie') {
    snapshotChart = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: labels,
        datasets: [{
          label: 'Pct',
          data: data.map(d => d.percent_of_group),
          backgroundColor: bgColors
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              usePointStyle: true,
              generateLabels: (chart) => {
                const ds = chart.data.datasets[0];
                return chart.data.labels.map((lbl, i) => ({
                  text: `${lbl}   ${Number(ds.data[i]).toFixed(1)}%`,
                  fillStyle: bgColors[i],
                  strokeStyle: bgColors[i],
                  fontColor: bgColors[i],
                  lineWidth: 0,
                  index: i,
                  hidden: false,
                }));
              }
            }
          },
          tooltip: { enabled: false }
        }
      }
    });
  }
  else if (activeType === 'bubble') {
    const rootData = { name: "root", children: data };
    const packLayout = pack().size([600, 600]).padding(2);
    const rootNode = hierarchy(rootData).sum(d => d.level);
    const packedNodes = packLayout(rootNode).leaves();
    
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const mappedData = packedNodes.map((node) => {
      const r = node.r;
      minX = Math.min(minX, node.x - r); maxX = Math.max(maxX, node.x + r);
      minY = Math.min(minY, node.y - r); maxY = Math.max(maxY, node.y + r);
      const subsetKey = node.data[selectedCategory] || node.data.series_description;
      return { x: node.x, y: node.y, r: r, subset: subsetKey, value: node.data.level, backgroundColor: activeColorMap[subsetKey] || '#cbd5e1' };
    });

    snapshotChart = new Chart(ctx, {
      type: 'bubble',
      data: {
        datasets: mappedData.map(node => ({
          label: node.subset,
          data: [{ x: node.x, y: node.y, r: node.r }],
          backgroundColor: node.backgroundColor,
          volume: node.value
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right' },
          tooltip: { callbacks: { label: (context) => `Unemployed: ${Number(mappedData[context.datasetIndex].value).toFixed(1)} K` } }
        },
        scales: { x: { display: false, min: minX - 20, max: maxX + 20 }, y: { display: false, min: minY - 20, max: maxY + 20 } }
      }
    });
  }
}
