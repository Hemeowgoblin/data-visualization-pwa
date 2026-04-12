export const CATEGORIES = [
  {
    id: 'educational_attainment',
    label: 'Educational Attainment',
    subsets: [
      'Less than a High School Diploma',
      'High School Graduates, No College',
      'Some College or Associate Degree',
      'Bachelor\'s Degree',
      'Master\'s Degree',
      'Professional Degree',
      'Doctoral Degree',
      'All'
    ]
  },
  {
    id: 'race',
    label: 'Race',
    subsets: ['Asian', 'Black or African American', 'Hispanic or Latino', 'White', 'All']
  },
  {
    id: 'nativity',
    label: 'Nativity',
    subsets: ['Native Born', 'Foreign Born', 'All']
  },
  {
    id: 'disability',
    label: 'Disability',
    subsets: ['With a Disability', 'With No Disability', 'All']
  },
  {
    id: 'industry_and_class',
    label: 'Industry and Class of Worker',
    subsets: [
      'Agricultural and Related Private Wage and Salary Workers',
      'All Industries Government Wage & Salary Workers',
      'All Industries, Self-Employed, Unincorporated, and Unpaid Family Workers',
      'Nonagriculture, Private Wage and Salary Workers',
      'All'
    ]
  },
  {
    id: 'occupation',
    label: 'Occupation',
    subsets: [
      'Management, Professional, and Related Occupations',
      'Natural Resources, Construction, and Maintenance Occupations',
      'Production, Transportation and Material Moving Occupations',
      'Sales and Office Occupations',
      'Service Occupations',
      'All'
    ]
  },
  {
    id: 'period_of_service',
    label: 'Period of Service',
    subsets: [
      'Gulf War Era I',
      'Gulf War Era II',
      'Vietnam-Era and Earlier Wartime Periods',
      'Other Service Periods',
      'All'
    ]
  },
  {
    id: 'veteran_status',
    label: 'Veteran Status',
    subsets: ['Total Veterans', 'Veterans', 'Nonveterans', 'All']
  },
  {
    id: 'gender',
    label: 'Gender',
    subsets: ['Men', 'Women', 'All']
  },
  {
    id: 'age',
    label: 'Age [years]',
    subsets: [
      '≥16', '≥18', '≥20', '16-17', '18-19', '16-19', '20-24', '25-34', '35-44', '45-54', '55-64', '16-64', '≥65', 'All'
    ]
  }
];

export const AGE_COMPARISON_SUBSETS = [
  '16-17', '18-19', '20-24', '25-34', '35-44', '45-54', '55-64', '≥65'
];
