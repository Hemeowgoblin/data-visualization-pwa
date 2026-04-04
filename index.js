import './index.css';

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

let globalMetadata = null; 
let currentValidYears = [];

worker.onmessage = (e) => {
  const data = e.data;
  if (data.type === 'DATA_LOADED') {
    worker.postMessage({ type: 'GET_METADATA' });
  } else if (data.type === 'METADATA') {
    globalMetadata = data.payload;
  } else if (data.type === 'YEAR_INTERSECTION') {
    currentValidYears = data.years;
    populateYearDropdowns(currentValidYears);
  } else if (data.type === 'FILTERED_DATA') {
    renderCharts(data.year, data.payload);
  }
};

subjectSelect.addEventListener('change', () => {
    parameterSelect.disabled = false;
});

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
    
    // Sort logic
    const customSort = (a, b) => {
        const order = { 'Male': 1, 'Female': 2, 'Combined': 3 };
        const valA = order[a] || 4;
        const valB = order[b] || 4;
        return valA - valB;
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

  checkboxes.forEach(cb => {
      cb.addEventListener('change', () => {
          validateConfirmButton();
      });
  });

  if (combinedBox) {
    // When "Combined" is toggled
    combinedBox.addEventListener('change', (e) => {
      if (e.target.checked) {
        otherBoxes.forEach(cb => cb.checked = true);
      }
      validateConfirmButton();
    });

    // When other sub-boxes are toggled
    otherBoxes.forEach(cb => {
      cb.addEventListener('change', () => {
        if (!cb.checked && combinedBox.checked) {
            combinedBox.checked = false;
        }

        // Check if all others are checked, and if so, check combined
        const allOthersChecked = otherBoxes.every(box => box.checked);
        if (allOthersChecked && !combinedBox.checked) {
            combinedBox.checked = true;
        }

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

// Wizard Flow Step 2: Confirm Choices
confirmChoicesBtn.addEventListener('click', () => {
  if (confirmChoicesBtn.textContent === 'Edit Choices') {
    // Unlock and revert to State Setup
    flowContainer.className = 'flow-container state-setup';
    dateSelectionArea.classList.add('hidden');
    confirmChoicesBtn.textContent = 'Confirm Choices';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  flowContainer.className = 'flow-container state-confirmed';
  
  const selectedCategory = parameterSelect.value;
  const activeGenders = Array.from(document.querySelectorAll('.filter-checkbox:checked')).map(cb => cb.value);

  confirmChoicesBtn.textContent = 'Edit Choices';
  dateSelectionArea.classList.remove('hidden');

  worker.postMessage({
    type: 'CALCULATE_YEARS',
    category: selectedCategory,
    genders: activeGenders
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

// Wizard Flow Step 3: Generate
generateVizBtn.addEventListener('click', () => {
  const start = parseInt(startYearSelect.value);
  const end = parseInt(endYearSelect.value);

  if (start > end) {
    alert("Start Year cannot be greater than End Year.");
    return;
  }

  // Advance to State Visualized
  flowContainer.className = 'flow-container state-visualized';
  blockVisuals.classList.remove('hidden');

  yearSlider.min = start;
  yearSlider.max = end;
  yearSlider.value = start;
  currentYearDisplay.textContent = start;
  
  requestDataForYear(start);

  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// Reset logic
resetSelectionsBtn.addEventListener('click', () => {
  location.reload(); 
});

yearSlider.addEventListener('input', (e) => {
  currentYearDisplay.textContent = e.target.value;
  requestDataForYear(parseInt(e.target.value));
});

document.getElementById('prevYear').addEventListener('click', () => {
  let val = parseInt(yearSlider.value) - 1;
  if (val >= yearSlider.min) {
    yearSlider.value = val;
    currentYearDisplay.textContent = val;
    requestDataForYear(val);
  }
});

document.getElementById('nextYear').addEventListener('click', () => {
  let val = parseInt(yearSlider.value) + 1;
  if (val <= yearSlider.max) {
    yearSlider.value = val;
    currentYearDisplay.textContent = val;
    requestDataForYear(val);
  }
});

function requestDataForYear(year) {
  const selectedCategory = parameterSelect.value;
  const activeGenders = Array.from(document.querySelectorAll('.filter-checkbox:checked')).map(cb => cb.value);

  worker.postMessage({ 
    type: 'FILTER_BY_YEAR',
    year: year,
    category: selectedCategory,
    genders: activeGenders
  });
}

function renderCharts(year, data) {
  if (data && data.length > 0) {
    document.querySelectorAll('.chart-empty-state').forEach(el => {
      el.textContent = `Visualizing ${data.length} datapoints for ${year}...`;
    });
  } else {
    document.querySelectorAll('.chart-empty-state').forEach(el => {
      el.textContent = `No data found for ${year}.`;
    });
  }
}
