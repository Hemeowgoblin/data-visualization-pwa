import './index.css';
import Chart from 'chart.js/auto';
import { pack, hierarchy } from 'd3-hierarchy';

console.log('Main thread initializing.');

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

// UI Elements
const flowContainer = document.getElementById('flowContainer');
const subjectSelect = document.getElementById('subjectSelect');
const parameterSelect = document.getElementById('parameterSelect');
const filtersArea = document.getElementById('filtersArea');
const dynamicFiltersContainer = document.getElementById('dynamicFiltersContainer');
const filterActionBtns = document.getElementById('filterActionBtns');
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

// Helper logic for single gender fetching based on Filter State checks
function getActiveGenderString() {
  const activeGenders = Array.from(document.querySelectorAll('.filter-checkbox:checked')).map(cb => cb.value);
  if (activeGenders.includes('Combined')) return 'Combined';
  if (activeGenders.includes('Male')) return 'Male';
  if (activeGenders.includes('Female')) return 'Female';
  return 'Combined'; // Fallback
}

// Custom plugin for drawing the vertical scrubber line on the trend chart
const verticalLinePlugin = {
  id: 'verticalLine',
  afterDraw: (chart) => {
    const activeYearStr = currentYearDisplay.textContent;
    if (!activeYearStr || isNaN(parseInt(activeYearStr))) return;
    
    // Find X coordinate of the active year
    const xAxis = chart.scales.x;
    const yAxis = chart.scales.y;
    const xVal = parseInt(activeYearStr);
    
    // Safety check if the year exists on axis
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
    worker.postMessage({ type: 'GET_METADATA' });
  } else if (data.type === 'METADATA') {
    globalMetadata = data.payload;
  } else if (data.type === 'YEAR_INTERSECTION') {
    currentValidYears = data.years;
    populateYearDropdowns(currentValidYears);
  } else if (data.type === 'TREND_DATA') {
    currentTrendData = data.payload.lineData;
    currentGeneralData = data.payload.generalData;
    renderTrendChart();
  } else if (data.type === 'FILTERED_DATA') {
    currentSnapshotData = data.payload;
    renderSnapshotChart();
  }
};

/* --- Wizard Setup --- */
subjectSelect.addEventListener('change', () => { parameterSelect.disabled = false; });

parameterSelect.addEventListener('change', (e) => {
  const category = e.target.value;
  buildFilters(category);
});

function buildFilters(category) {
  dynamicFiltersContainer.innerHTML = '';
  filtersArea.classList.remove('hidden');
  filterActionBtns.classList.remove('hidden');
  
  const availableGenders = globalMetadata.categoryGenderMap[category] || [];
  
  if (availableGenders.length > 0) {
    const groupEl = document.createElement('div');
    groupEl.className = 'filter-group';
    groupEl.innerHTML = `<div class="filter-group-title">Gender</div><div class="chips-list" id="genderChips"></div>`;
    dynamicFiltersContainer.appendChild(groupEl);
    
    const chipsContainer = groupEl.querySelector('.chips-list');
    
    const customSort = (a, b) => {
        const order = { 'Male': 1, 'Female': 2, 'Combined': 3 };
        return (order[a] || 4) - (order[b] || 4);
    };
    const sorted = [...availableGenders].sort(customSort);
    
    sorted.forEach(gender => {
      const label = document.createElement('label');
      label.className = 'chip-label';
      label.innerHTML = `
        <input type="checkbox" class="chip-checkbox filter-checkbox" data-type="Gender" value="${gender}" checked>
        <span>${gender}</span>
      `;
      chipsContainer.appendChild(label);
    });
    
    bindCombinedLogic(chipsContainer);
    validateConfirmButton();
  } else {
    dynamicFiltersContainer.innerHTML = '<div class="chart-empty-state">No filters available for this parameter.</div>';
    confirmChoicesBtn.classList.remove('disabled');
    confirmChoicesBtn.disabled = false;
  }
}

function bindCombinedLogic(container) {
  const checkboxes = container.querySelectorAll('.chip-checkbox');
  const combinedBox = Array.from(checkboxes).find(cb => cb.value.toLowerCase() === 'combined');
  const otherBoxes = Array.from(checkboxes).filter(cb => cb !== combinedBox);

  checkboxes.forEach(cb => { cb.addEventListener('change', validateConfirmButton); });

  if (combinedBox) {
    combinedBox.addEventListener('change', (e) => {
      if (e.target.checked) otherBoxes.forEach(cb => cb.checked = true);
      validateConfirmButton();
    });

    otherBoxes.forEach(cb => {
      cb.addEventListener('change', () => {
        if (!cb.checked && combinedBox.checked) combinedBox.checked = false;
        const allOthersChecked = otherBoxes.every(box => box.checked);
        if (allOthersChecked && !combinedBox.checked) combinedBox.checked = true;
        validateConfirmButton();
      });
    });
  }
}

function validateConfirmButton() {
    const activeFilters = document.querySelectorAll('.filter-checkbox:checked');
    if (activeFilters.length > 0) {
        confirmChoicesBtn.classList.remove('disabled');
        confirmChoicesBtn.disabled = false;
    } else {
        confirmChoicesBtn.classList.add('disabled');
        confirmChoicesBtn.disabled = true;
    }
}

document.getElementById('checkAllFiltersBtn').addEventListener('click', () => {
  document.querySelectorAll('.filter-checkbox').forEach(cb => cb.checked = true);
  validateConfirmButton();
});
document.getElementById('uncheckAllFiltersBtn').addEventListener('click', () => {
  document.querySelectorAll('.filter-checkbox').forEach(cb => cb.checked = false);
  validateConfirmButton();
});

/* --- Transitions --- */
confirmChoicesBtn.addEventListener('click', () => {
  if (confirmChoicesBtn.textContent === 'Edit Choices') {
    flowContainer.className = 'flow-container state-setup';
    dateSelectionArea.classList.add('hidden');
    confirmChoicesBtn.textContent = 'Confirm Choices';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  flowContainer.className = 'flow-container state-confirmed';
  
  const selectedCategory = parameterSelect.value;
  // Based on user comments, gender choice doesn't spawn more lines.
  // We resolve the UI checkboxes into the exact single Gender string requested.
  const resolvedGender = getActiveGenderString();

  confirmChoicesBtn.textContent = 'Edit Choices';
  dateSelectionArea.classList.remove('hidden');

  // Request the year bounds
  worker.postMessage({
    type: 'CALCULATE_YEARS',
    category: selectedCategory,
    genders: [resolvedGender] 
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
});

function populateYearDropdowns(years) {
  startYearSelect.innerHTML = '';
  endYearSelect.innerHTML = '';
  
  if (years.length === 0) {
    startYearSelect.innerHTML = '<option disabled>No valid data</option>';
    endYearSelect.innerHTML = '<option disabled>No valid data</option>';
    generateVizBtn.classList.add('disabled');
    generateVizBtn.disabled = true;
    return;
  }
  
  generateVizBtn.classList.remove('disabled');
  generateVizBtn.disabled = false;

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
  
  // Kick off fetching the full matrix for the Line Chart
  const selectedCategory = parameterSelect.value;
  worker.postMessage({
    type: 'GET_TREND_DATA',
    startYear: currentStartYear,
    endYear: currentEndYear,
    category: selectedCategory,
    genders: [getActiveGenderString()]
  });

  // Kick off fetching the target year snapshot
  requestDataForYear(currentStartYear);

  window.scrollTo({ top: 0, behavior: 'smooth' });
});

/* --- Interactions --- */
resetSelectionsBtn.addEventListener('click', () => { location.reload(); });

yearSlider.addEventListener('input', (e) => {
  currentYearDisplay.textContent = e.target.value;
  requestDataForYear(parseInt(e.target.value));
  // Redraw trend chart to update scrubber
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
  radio.addEventListener('change', () => {
    renderSnapshotChart();
  });
});

function requestDataForYear(year) {
  worker.postMessage({ 
    type: 'FILTER_BY_YEAR',
    year: year,
    category: parameterSelect.value,
    genders: [getActiveGenderString()]
  });
}

/* --- Color Palettes --- */
function getPaletteColors() {
  return ['#6366f1', '#eab308', '#06b6d4', '#f97316', '#8b5cf6', '#a855f7', '#64748b', '#38bdf8', '#fbbf24'];
}

function buildColorMap(subsets) {
  activeColorMap = {};
  const palette = getPaletteColors();
  let colorIdx = 0;
  
  subsets.forEach(sub => {
    if (sub === 'Male') activeColorMap[sub] = '#3b82f6';
    else if (sub === 'Female') activeColorMap[sub] = '#ec4899'; // Pink
    else if (sub === 'General' || sub === 'Total 16+') activeColorMap[sub] = '#22c55e'; // Shared Green for Baseline
    else {
      activeColorMap[sub] = palette[colorIdx % palette.length];
      colorIdx++;
    }
  });
}

/* --- Rendering Engines --- */
const getRate = (p) => {
  const v = p.Value_Percentage ?? p.Rate ?? p.Rate_Pct ?? p['Rate_%'];
  return (v !== undefined && v !== null) ? Number(v) : null;
};

function renderTrendChart() {
  const ctx = document.getElementById('lineChartCanvas')?.getContext('2d');
  if (!ctx) return;
  if (trendChart) trendChart.destroy();

  // Create datasets based on active lines.
  const subsets = [...new Set(currentTrendData.map(d => d.Subset))];
  
  // Rebuild color map whenever we draw lines (base of truth)
  buildColorMap(subsets);

  const datasets = subsets.map((sub, idx) => {
    // Filter data for this line
    const linePoints = currentTrendData.filter(d => d.Subset === sub).sort((a,b) => a.Year - b.Year);
    const color = activeColorMap[sub];
    return {
      label: sub,
      data: linePoints.map(p => ({ x: p.Year, y: getRate(p) })),
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 6
    };
  });

  // Check general overlay
  if (generalTrendToggle.checked) {
    const generalPoints = currentGeneralData.sort((a,b) => a.Year - b.Year);
    datasets.push({
      label: 'General Trend (16+ Combined)',
      data: generalPoints.map(p => ({ x: p.Year, y: getRate(p) })),
      borderColor: '#22c55e', // Green for baseline
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
        legend: { labels: { color: '#a0a6b1' } },
        tooltip: { mode: 'index', intersect: false }
      },
      scales: {
        x: { 
          type: 'linear', 
          min: currentStartYear, 
          max: currentEndYear, 
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#a0a6b1', callback: val => val }
        },
        y: {
          title: { display: true, text: 'Unemployment Rate (%)', color: '#a0a6b1' },
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#a0a6b1' }
        }
      }
    }
  });
}

function renderSnapshotChart() {
  const ctx = document.getElementById('mainChartCanvas').getContext('2d');
  if (snapshotChart) snapshotChart.destroy();

  // Detect if ANY subset is missing data for the current selection
  // Only null/undefined are considered missing; 0 is a valid rate.
  const hasMissingData = currentSnapshotData.some(d => {
    const r = getRate(d);
    return r === null || d.UnemployedLevel === null;
  });
  const chartTypeInputs = document.querySelectorAll('input[name="chartType"]');

  if (hasMissingData && currentSnapshotData.length > 0) {
    chartTypeInputs.forEach(r => {
      if (r.value !== 'bar') {
        r.disabled = true;
        r.parentElement.style.opacity = '0.4';
        r.parentElement.style.cursor = 'not-allowed';
      } else {
        r.checked = true; // Auto-force Bar chart
      }
    });
  } else {
    chartTypeInputs.forEach(r => {
      r.disabled = false;
      r.parentElement.style.opacity = '1';
      r.parentElement.style.cursor = 'pointer';
    });
  }

  const activeType = document.querySelector('input[name="chartType"]:checked').value;

  // For Bar Chart, we keep ALL subsets to show "No available data"
  // For Pie/Bubble, we filter for values > 0
  let data = [];
  if (activeType === 'bar') {
    data = [...currentSnapshotData].sort((a,b) => a.Subset.localeCompare(b.Subset));
  } else {
    data = [...currentSnapshotData].filter(d => getRate(d) > 0).sort((a, b) => b.Rate - a.Rate);
  }
  
  const emptyStateEl = document.querySelector('#mainChartContainer .chart-empty-state');
  const canvasEl = document.getElementById('mainChartCanvas');

  if (data.length === 0) {
    emptyStateEl.textContent = 'No data available for this specific year.';
    emptyStateEl.classList.remove('hidden');
    canvasEl.style.opacity = '0';
  } else {
    emptyStateEl.classList.add('hidden');
    canvasEl.style.opacity = '1';
  }

  let labels = data.map(d => d.Subset);
  
  // Synchronous Color Mapping
  const bgColors = data.map(d => activeColorMap[d.Subset] || '#64748b');

  if (activeType === 'bar') {
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
        indexAxis: 'y', // Horizontal
        responsive: true,
        maintainAspectRatio: false,
        plugins: { 
          legend: { display: false },
          tooltip: { enabled: true }
        },
        scales: {
          x: { 
            display: false, // No X Axis as per request
            grid: { display: false },
            ticks: { display: false }
          },
          y: { 
            grid: { display: false }, 
            ticks: { color: '#f2f4f7', font: { size: 12, weight: 'bold' } } 
          }
        }
      },
      plugins: [{
        id: 'barLabels',
        afterDatasetsDraw: (chart) => {
          const { ctx, data } = chart;
          chart.getDatasetMeta(0).data.forEach((bar, index) => {
            const rawVal = data.datasets[0].data[index];
            const label = (rawVal !== null && rawVal > 0) ? `${rawVal}%` : "No available data";
            const color = data.datasets[0].backgroundColor[index];
            
            ctx.save();
            ctx.fillStyle = color;
            ctx.font = 'bold 12px Inter';
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            
            // Draw text to the right of the bar
            // If rawVal is null, x will be at the scale origin
            const xPos = Math.max(bar.x, bar.base) + 12;
            const yPos = bar.y;
            ctx.fillText(label, xPos, yPos);
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
          label: 'Percent of Unemployed People',
          data: data.map(d => d.PercentOfCategory),
          backgroundColor: bgColors,
          borderColor: '#0f1115',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true, // Maintain circular shape
        aspectRatio: 1, // Full panel height
        plugins: {
          legend: { 
            position: 'bottom', 
            labels: { color: '#f2f4f7', padding: 25, font: { size: 11 } } 
          },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${ctx.raw}%`
            }
          }
        }
      }
    });
  }
  
  else if (activeType === 'bubble') {
    // Circle Packing using D3 Hierarchy
    // We treat the dataset as leaves of a root tree node
    const rootData = { name: "root", children: data };
    const packLayout = pack()
        .size([600, 600]) 
        .padding(10);     
        
    const rootNode = hierarchy(rootData)
        .sum(d => d.UnemployedLevel); // Math based strictly on raw volumes
        
    const packedNodes = packLayout(rootNode).leaves();
    
    // Map the packed coordinates into Chart.js bubble points
    const mappedData = packedNodes.map((node, i) => {
      return {
        x: node.x,
        y: node.y,
        r: node.r * 0.8, 
        subset: node.data.Subset,
        value: node.data.UnemployedLevel, // Storing for tooltip
        backgroundColor: activeColorMap[node.data.Subset] || '#cbd5e1'
      };
    });

    snapshotChart = new Chart(ctx, {
      type: 'bubble',
      data: {
        datasets: mappedData.map(node => ({
          label: node.subset,
          data: [{ x: node.x, y: node.y, r: node.r }],
          backgroundColor: node.backgroundColor,
          borderWidth: 1,
          borderColor: '#0f1115'
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: 10
        },
        plugins: {
          legend: { position: 'bottom', labels: { color: '#f2f4f7', padding: 10 } },
          tooltip: {
            callbacks: {
               label: (context) => {
                 const n = mappedData[context.datasetIndex];
                 return `Number of Unemployed People (Volume): ${n.value} K`;
               }
            }
          }
        },
        scales: {
          x: { display: false, min: -50, max: 650 }, // Padding for circles
          y: { display: false, min: -50, max: 650 }
        }
      }
    });
  }
}
