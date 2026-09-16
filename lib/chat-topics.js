const TOPIC_DEFINITIONS = [
  {
    topic: 'complex numbers',
    synonyms: ['complex number', 'complex numbers', 'complex no', 'complex nos', 'complex num', 'complex variable', 'complex variables', 'functions of complex variable', 'de moivre'],
    canonicalSubject: 'Mathematics II',
    semesterNum: 2,
    unit: 'Unit 5: Functions of Complex Variable'
  },
  {
    topic: 'matrices and determinants',
    synonyms: ['matrices', 'matrix', 'determinant', 'determinants', 'cramers rule', 'eigenvalues'],
    canonicalSubject: 'Mathematics I',
    semesterNum: 1,
    unit: 'Unit 4: Matrices and Determinants'
  },
  {
    topic: 'derivatives and calculus',
    synonyms: ['derivative', 'derivatives', 'differentiation', 'calculus', 'taylor series', 'limits and continuity'],
    canonicalSubject: 'Mathematics I',
    semesterNum: 1,
    unit: 'Unit 1 & 2: Derivatives & Applications'
  },
  {
    topic: 'normalization',
    synonyms: ['normalization', '1nf', '2nf', '3nf', 'bcnf', 'functional dependency', 'functional dependencies'],
    canonicalSubject: 'Database Management System',
    semesterNum: 3,
    unit: 'Unit 5: Relational Database Design'
  },
  {
    topic: 'sql queries and relational algebra',
    synonyms: ['sql', 'queries', 'ddl', 'dml', 'relational algebra', 'joins', 'subqueries'],
    canonicalSubject: 'Database Management System',
    semesterNum: 3,
    unit: 'Unit 4: Relational Language and Database Constraints'
  },
  {
    topic: 'graphs and shortest path',
    synonyms: ['graph', 'graphs', 'graph theory', 'dijkstra', 'kruskal', 'prim', 'bfs', 'dfs', 'minimum spanning tree', 'shortest path', 'isomorphism', 'graph coloring'],
    canonicalSubject: 'Discrete Mathematics',
    semesterNum: 2,
    unit: 'Unit 5: Graph Theory'
  },
  {
    topic: 'logic and proposition',
    synonyms: ['logic', 'proposition', 'truth table', 'predicates', 'quantifiers', 'nested quantifiers', 'tautology', 'logical equivalence'],
    canonicalSubject: 'Discrete Mathematics',
    semesterNum: 2,
    unit: 'Unit 1: Logic and Induction'
  },
  {
    topic: 'mathematical reasoning and proofs',
    synonyms: ['proof', 'proofs', 'direct proof', 'indirect proof', 'rules of inference', 'mathematical reasoning'],
    canonicalSubject: 'Discrete Mathematics',
    semesterNum: 2,
    unit: 'Unit 2: Mathematical Reasoning'
  },
  {
    topic: 'automata and fsm',
    synonyms: ['automata', 'fsm', 'fsa', 'dfa', 'nfa', 'finite state', 'grammars', 'languages', 'nfa to dfa'],
    canonicalSubject: 'Discrete Mathematics',
    semesterNum: 2,
    unit: 'Unit 3: Finite state Automata, Grammars and Languages'
  },
  {
    topic: 'recurrence relation',
    synonyms: ['recurrence relation', 'linear recurrence', 'non linear recurrence', 'recursive definition'],
    canonicalSubject: 'Discrete Mathematics',
    semesterNum: 2,
    unit: 'Unit 4: Recurrence Relation'
  },
  {
    topic: 'complex numbers and variables',
    synonyms: ['complex number', 'complex numbers', 'complex variable', 'cauchy riemann', 'analytic function', 'harmonic function'],
    canonicalSubject: 'Mathematics II',
    semesterNum: 2,
    unit: 'Unit 5: Functions of Complex Variable'
  },
  {
    topic: 'several variables and partial derivatives',
    synonyms: ['several variables', 'partial derivative', 'partial derivatives', 'maxima and minima', 'total derivative', 'euler theorem'],
    canonicalSubject: 'Mathematics II',
    semesterNum: 2,
    unit: 'Unit 3: Function of Several Variables'
  },
  {
    topic: 'permutation and combination',
    synonyms: ['permutation', 'permutations', 'combination', 'combinations', 'counting principle'],
    canonicalSubject: 'Mathematics II',
    semesterNum: 2,
    unit: 'Unit 1: Permutation and Combination'
  },
  {
    topic: 'sorting and searching',
    synonyms: ['sorting', 'quicksort', 'mergesort', 'bubblesort', 'heapsort', 'binary search', 'linear search', 'hashing'],
    canonicalSubject: 'Data Structure and Algorithms',
    semesterNum: 3,
    unit: 'Unit 5 & 6: Sorting & Searching'
  },
  {
    topic: 'processes and deadlock',
    synonyms: ['deadlock', 'deadlocks', 'process synchronization', 'bankers algorithm', 'semaphores', 'mutex', 'cpu scheduling'],
    canonicalSubject: 'Operating Systems',
    semesterNum: 4,
    unit: 'Process Management & Deadlock'
  },
  {
    topic: 'memory management and paging',
    synonyms: ['paging', 'virtual memory', 'page replacement', 'segmentation', 'memory management'],
    canonicalSubject: 'Operating Systems',
    semesterNum: 4,
    unit: 'Memory Management'
  },
  {
    topic: '8085 microprocessor',
    synonyms: ['8085', 'intel 8085', '8085 microprocessor', 'pin diagram', 'instruction cycle', 'addressing modes'],
    canonicalSubject: 'Microprocessor and Computer Architecture',
    semesterNum: 3,
    unit: 'Unit 2: Intel 8085'
  },
  {
    topic: 'logic gates and k-map',
    synonyms: ['logic gate', 'logic gates', 'k-map', 'karnaugh map', 'boolean simplification', 'demorgan'],
    canonicalSubject: 'Digital Logic',
    semesterNum: 2,
    unit: 'Unit 3: Boolean Algebra'
  },
  {
    topic: 'flip flops and counters',
    synonyms: ['flip flop', 'flip flops', 'jk flip flop', 'rs flip flop', 'counter', 'registers', 'shift register'],
    canonicalSubject: 'Digital Logic',
    semesterNum: 2,
    unit: 'Unit 5 & 6: Sequential Circuits & Counters'
  },
  {
    topic: 'css and styling',
    synonyms: ['css', 'cascading style sheet', 'cascading style sheets', 'css selectors', 'styling'],
    canonicalSubject: 'Web Technology I',
    semesterNum: 2,
    unit: 'Unit 3: Introducing Cascading Style Sheet'
  },
  {
    topic: 'html and web markup',
    synonyms: ['html', 'xhtml', 'html forms', 'tables', 'web markup', 'html elements'],
    canonicalSubject: 'Web Technology I',
    semesterNum: 2,
    unit: 'Unit 2: HTML and XHTML'
  },
  {
    topic: 'javascript basics',
    synonyms: ['javascript', 'js', 'dom', 'form validation', 'client script'],
    canonicalSubject: 'Web Technology I',
    semesterNum: 2,
    unit: 'Unit 4: Learning JavaScript'
  },
  {
    topic: 'php and mysql',
    synonyms: ['php', 'mysql', 'php mysql', 'server side php', 'crud in php'],
    canonicalSubject: 'Web Technology I',
    semesterNum: 2,
    unit: 'Unit 5: Programming in PHP and MYSQL'
  },
  {
    topic: 'java oop and basics',
    synonyms: ['java', 'java basics', 'oop java', 'java oop', 'inheritance in java', 'java exceptions', 'java io', 'event handling', 'swing'],
    canonicalSubject: 'Computer Programming II (Java)',
    semesterNum: 2,
    unit: 'Java Programming'
  },
  {
    topic: 'infinite series',
    synonyms: ['infinite series', 'convergence of series', 'alternating series', 'power series', 'radius of convergence'],
    canonicalSubject: 'Mathematics II',
    semesterNum: 2,
    unit: 'Unit 2: Infinite Series'
  },
  {
    topic: 'differential equations',
    synonyms: ['differential equations', 'differential equation', 'ode', 'homogeneous differential', 'initial value problem', '2nd order de'],
    canonicalSubject: 'Mathematics II',
    semesterNum: 2,
    unit: 'Unit 4: Differential Equations'
  }
];

TOPIC_DEFINITIONS.push(
  { topic: 'object oriented programming', synonyms: ['inheritance', 'polymorphism', 'encapsulation', 'abstraction', 'overloading', 'overriding'], canonicalSubject: 'Computer Programming II (Java)', semesterNum: 2 },
  { topic: 'entity relationship model', synonyms: ['er diagram', 'entity relationship', 'entity relationship diagram'], canonicalSubject: 'Database Management System', semesterNum: 3 },
  { topic: 'computer networks', synonyms: ['osi model', 'tcp', 'ip addressing', 'subnetting', 'routing protocols'], canonicalSubject: 'Data Communication and Computer Networks', semesterNum: 4 }
);
module.exports = TOPIC_DEFINITIONS;
