'use strict';

const syllabus = require('../public/syllabus-data.json');

const ROMAN_TO_NUM = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };

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
    synonyms: ['matrices', 'matrix', 'determinant', 'determinants', 'cramers rule', 'eigenvalues', 'gaussian elimination'],
    canonicalSubject: 'Mathematics I',
    semesterNum: 1,
    unit: 'Unit 4: Matrices and Determinants'
  },
  {
    topic: 'derivatives and calculus',
    synonyms: ['derivative', 'derivatives', 'differentiation', 'calculus', 'taylor series', 'maclaurin series', 'rolle theorem', 'mean value theorem', 'limits and continuity'],
    canonicalSubject: 'Mathematics I',
    semesterNum: 1,
    unit: 'Unit 1 & 2: Derivatives & Applications'
  },
  {
    topic: 'normalization',
    synonyms: ['normalization', '1nf', '2nf', '3nf', 'bcnf', 'functional dependency', 'functional dependencies', 'boyce codd', 'first normal form', 'second normal form', 'third normal form'],
    canonicalSubject: 'Database Management System',
    semesterNum: 3,
    unit: 'Unit 5: Relational Database Design'
  },
  {
    topic: 'sql queries and relational algebra',
    synonyms: ['sql', 'queries', 'ddl', 'dml', 'relational algebra', 'joins', 'subqueries', 'primary key', 'foreign key', 'acid properties', 'concurrency control', 'two phase locking'],
    canonicalSubject: 'Database Management System',
    semesterNum: 3,
    unit: 'Unit 4: Relational Language and Database Constraints'
  },
  {
    topic: 'graphs and shortest path',
    synonyms: ['graph', 'graphs', 'graph theory', 'dijkstra', 'kruskal', 'prim', 'bfs', 'dfs', 'minimum spanning tree', 'shortest path', 'isomorphism', 'graph coloring', 'bipartite graph', 'hamiltonian graph', 'euler graph'],
    canonicalSubject: 'Discrete Mathematics',
    semesterNum: 2,
    unit: 'Unit 5: Graph Theory'
  },
  {
    topic: 'logic and proposition',
    synonyms: ['logic', 'proposition', 'propositional logic', 'predicate logic', 'truth table', 'predicates', 'quantifiers', 'nested quantifiers', 'tautology', 'logical equivalence'],
    canonicalSubject: 'Discrete Mathematics',
    semesterNum: 2,
    unit: 'Unit 1: Logic and Induction'
  },
  {
    topic: 'mathematical reasoning and proofs',
    synonyms: ['proof', 'proofs', 'direct proof', 'indirect proof', 'rules of inference', 'mathematical reasoning', 'mathematical induction'],
    canonicalSubject: 'Discrete Mathematics',
    semesterNum: 2,
    unit: 'Unit 2: Mathematical Reasoning'
  },
  {
    topic: 'automata and fsm',
    synonyms: ['automata', 'fsm', 'fsa', 'dfa', 'nfa', 'finite state', 'grammars', 'languages', 'nfa to dfa', 'context free grammar'],
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
    synonyms: ['permutation', 'permutations', 'combination', 'combinations', 'counting principle', 'pigeonhole principle'],
    canonicalSubject: 'Mathematics II',
    semesterNum: 2,
    unit: 'Unit 1: Permutation and Combination'
  },
  {
    topic: 'sorting and searching',
    synonyms: ['sorting', 'quicksort', 'mergesort', 'bubblesort', 'heapsort', 'insertion sort', 'selection sort', 'binary search', 'linear search', 'hashing', 'hash table', 'avl tree', 'binary search tree', 'b tree', 'linked list', 'stack and queue'],
    canonicalSubject: 'Data Structure and Algorithms',
    semesterNum: 3,
    unit: 'Unit 5 & 6: Sorting & Searching'
  },
  {
    topic: 'processes and deadlock',
    synonyms: ['deadlock', 'deadlocks', 'process synchronization', 'bankers algorithm', 'banker algorithm', 'semaphores', 'semaphore', 'mutex', 'cpu scheduling', 'round robin', 'fcfs', 'sjf', 'coffman conditions'],
    canonicalSubject: 'Operating Systems',
    semesterNum: 4,
    unit: 'Unit 3: Process Management & Deadlock'
  },
  {
    topic: 'memory management and paging',
    synonyms: ['paging', 'virtual memory', 'page replacement', 'segmentation', 'memory management', 'thrashing', 'demand paging', 'lru page replacement'],
    canonicalSubject: 'Operating Systems',
    semesterNum: 4,
    unit: 'Unit 4: Memory Management'
  },
  {
    topic: '8085 microprocessor',
    synonyms: ['8085', '8086', 'intel 8085', '8085 microprocessor', 'pin diagram', 'instruction cycle', 'addressing modes', 'dma', 'pipelining'],
    canonicalSubject: 'Microprocessor and Computer Architecture',
    semesterNum: 3,
    unit: 'Unit 2: Intel 8085'
  },
  {
    topic: 'logic gates and k-map',
    synonyms: ['logic gate', 'logic gates', 'k-map', 'k map', 'karnaugh map', 'boolean simplification', 'boolean algebra', 'demorgan', 'de morgan', 'half adder', 'full adder', 'multiplexer', 'decoder'],
    canonicalSubject: 'Digital Logic',
    semesterNum: 2,
    unit: 'Unit 3: Boolean Algebra'
  },
  {
    topic: 'flip flops and counters',
    synonyms: ['flip flop', 'flip flops', 'jk flip flop', 'rs flip flop', 'd flip flop', 't flip flop', 'counter', 'registers', 'shift register', 'sequential circuit', 'combinational circuit'],
    canonicalSubject: 'Digital Logic',
    semesterNum: 2,
    unit: 'Unit 5 & 6: Sequential Circuits & Counters'
  },
  {
    topic: 'css and styling',
    synonyms: [
      'css', 'cascading style sheet', 'cascading style sheets', 'css selector', 'css selectors',
      'selector', 'selectors', 'selector in css', 'selectors in css', 'element selector',
      'id selector', 'class selector', 'attribute selector', 'pseudo class', 'pseudo-class',
      'pseudo element', 'box model', 'css box model', 'flexbox', 'css grid', 'styling'
    ],
    canonicalSubject: 'Web Technology I',
    semesterNum: 2,
    unit: 'Unit 3: Introducing Cascading Style Sheet'
  },
  {
    topic: 'html and web markup',
    synonyms: ['html', 'xhtml', 'html5', 'html forms', 'html tables', 'colspan', 'rowspan', 'web markup', 'html elements', 'html tags', 'semantic html'],
    canonicalSubject: 'Web Technology I',
    semesterNum: 2,
    unit: 'Unit 2: HTML and XHTML'
  },
  {
    topic: 'javascript basics',
    synonyms: ['javascript', 'js', 'dom', 'document object model', 'form validation', 'client script', 'event listener in js', 'ajax', 'json'],
    canonicalSubject: 'Web Technology I',
    semesterNum: 2,
    unit: 'Unit 4: Learning JavaScript'
  },
  {
    topic: 'php and mysql',
    synonyms: ['php', 'mysql', 'php mysql', 'server side php', 'crud in php', 'php session', 'php cookie'],
    canonicalSubject: 'Web Technology I',
    semesterNum: 2,
    unit: 'Unit 5: Programming in PHP and MYSQL'
  },
  {
    topic: 'java oop and basics',
    synonyms: ['java', 'java basics', 'oop java', 'java oop', 'inheritance in java', 'java exceptions', 'java io', 'event handling', 'swing', 'awt', 'jvm', 'bytecode', 'jdk', 'jre', 'multithreading in java'],
    canonicalSubject: 'Computer Programming II (Java)',
    semesterNum: 2,
    unit: 'Unit 1–9: Java Programming & OOP'
  },
  {
    topic: 'infinite series',
    synonyms: ['infinite series', 'convergence of series', 'alternating series', 'power series', 'radius of convergence', 'ratio test', 'root test'],
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
  },
  {
    topic: 'object oriented programming',
    synonyms: ['inheritance', 'polymorphism', 'encapsulation', 'abstraction', 'overloading', 'overriding', 'abstract class'],
    canonicalSubject: 'Computer Programming II (Java)',
    semesterNum: 2,
    unit: 'Unit 5: Inheritance, Package and Interface'
  },
  {
    topic: 'entity relationship model',
    synonyms: ['er diagram', 'entity relationship', 'entity relationship diagram', 'weak entity', 'cardinality ratio'],
    canonicalSubject: 'Database Management System',
    semesterNum: 3,
    unit: 'Unit 2: Entity-Relationship Model'
  },
  {
    topic: 'computer networks',
    synonyms: ['osi model', 'tcp', 'udp', 'ip addressing', 'ipv4', 'ipv6', 'subnetting', 'routing protocols', 'three way handshake', 'dns', 'dhcp'],
    canonicalSubject: 'Data Communication and Computer Networks',
    semesterNum: 4,
    unit: 'Unit 1–4: Computer Networks & Protocols'
  },
  {
    topic: 'c programming pointers and structures',
    synonyms: ['pointer in c', 'pointers in c', 'call by value', 'call by reference', 'malloc', 'calloc', 'structure and union', 'preprocessor directives'],
    canonicalSubject: 'Computer Programming,I (C)',
    semesterNum: 1,
    unit: 'Unit 8 & 9: Structure, Unions & Pointers'
  },
  {
    topic: 'electronics diodes and transistors',
    synonyms: ['kirchhoff', 'kcl', 'kvl', 'thevenin', 'norton', 'zener diode', 'rectifier', 'bjt', 'op amp', 'operational amplifier'],
    canonicalSubject: 'Basic Electronics',
    semesterNum: 1,
    unit: 'Unit 1–4: Circuit Theory, Diode, Transistor & Op-Amp'
  }
];

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function phraseInText(text, phrase) {
  const normText = ` ${normalizeText(text)} `;
  const normPhrase = ` ${normalizeText(phrase)} `;
  return normPhrase.trim().length > 0 && normText.includes(normPhrase);
}

/**
 * Resolves a query or text snippet to the best-matching BIT syllabus topic, subject, semester, and unit/folder.
 *
 * @param {string} query
 * @returns {{ topic: string, canonicalSubject: string, semesterNum: number, unit: string|null, matchedSynonyms: string[] } | null}
 */
function resolveSyllabusConcept(query) {
  const raw = String(query || '').trim();
  if (!raw) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const def of TOPIC_DEFINITIONS) {
    const matchedSyns = def.synonyms.filter(s => phraseInText(raw, s));
    if (matchedSyns.length > 0) {
      const longestSyn = Math.max(...matchedSyns.map(s => normalizeText(s).length));
      const score = (matchedSyns.length * 10) + longestSyn;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          topic: def.topic,
          canonicalSubject: def.canonicalSubject,
          semesterNum: def.semesterNum,
          unit: def.unit || null,
          matchedSynonyms: matchedSyns
        };
      }
    }
  }

  if (bestMatch) return bestMatch;

  // Fallback: scan public/syllabus-data.json course units for exact unit title matches
  const normQuery = normalizeText(raw);
  if (normQuery.length >= 4 && syllabus && Array.isArray(syllabus.semesters)) {
    for (const sem of syllabus.semesters) {
      const semNum = ROMAN_TO_NUM[String(sem.semester || '').toUpperCase()] || Number(sem.semester) || null;
      for (const course of (sem.courses || [])) {
        const contents = String(course.contents || '');
        const lines = contents.split(/\r?\n/);
        for (const line of lines) {
          const m = line.trim().match(/^(?:Unit\s+)?(\d{1,2})\s*[.:-]\s*(.+?)(?:\s*\(?\d+\s*(?:hrs?|hours?)\.?\))?$/i);
          if (m) {
            const unitNum = Number(m[1]);
            const unitTitle = m[2].trim();
            const normUnit = normalizeText(unitTitle);
            if (normUnit.length >= 5 && (phraseInText(raw, unitTitle) || phraseInText(unitTitle, raw))) {
              return {
                topic: unitTitle.toLowerCase(),
                canonicalSubject: course.title,
                semesterNum: semNum,
                unit: `Unit ${unitNum}: ${unitTitle}`,
                matchedSynonyms: [unitTitle]
              };
            }
          }
        }
      }
    }
  }

  return null;
}

/**
 * Formats a clean hierarchical folder path for any note file:
 * e.g. "Web Technology I / Chapter 2" or "Semester 2 / Web Technology I / Unit 3: Introducing Cascading Style Sheet"
 */
function formatNoteFolderPath(file = {}, query = '') {
  const concept = resolveSyllabusConcept(`${file.title || ''} ${file.chapter || ''} ${query || ''}`);
  const subject = String(file.subject || concept?.canonicalSubject || 'General').trim();
  const rawChap = String(file.chapter || '').trim();
  let chapterFolder = '';
  if (rawChap) {
    chapterFolder = /^(?:chapter|chap|unit|module|folder)\b/i.test(rawChap)
      ? rawChap
      : `Chapter ${rawChap}`;
  } else if (concept?.unit) {
    chapterFolder = concept.unit;
  }
  return [subject, chapterFolder].filter(Boolean).join(' / ');
}

Object.defineProperty(TOPIC_DEFINITIONS, 'resolveSyllabusConcept', {
  value: resolveSyllabusConcept,
  enumerable: false
});
Object.defineProperty(TOPIC_DEFINITIONS, 'formatNoteFolderPath', {
  value: formatNoteFolderPath,
  enumerable: false
});

module.exports = TOPIC_DEFINITIONS;
