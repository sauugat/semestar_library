'use strict';

const { evaluateAcademicAnswer, detectAcademicDiscipline } = require('../lib/academic-teaching-engine');

const TEST_SCENARIOS = [
  // 1. Math / Logic
  {
    id: 'math_imp_correct',
    subject: 'Discrete Mathematics',
    subjectCode: 'CIT121',
    topic: 'Conditional Statements',
    question: 'Under what condition is the implication P -> Q false?',
    studentAnswer: 'when P is true and Q is false',
    expectedPass: true,
    expectedScore: 1.0,
    expectedMisconception: null,
    expectedCategory: 'math'
  },
  {
    id: 'math_imp_partial_p_only',
    subject: 'Discrete Mathematics',
    subjectCode: 'CIT121',
    topic: 'Conditional Statements',
    question: 'Under what condition is the implication P -> Q false?',
    studentAnswer: 'When P is true',
    expectedPass: false,
    expectedScore: 0.5,
    expectedMisconception: 'Omitted condition for Q',
    expectedCategory: 'math'
  },
  {
    id: 'math_imp_misconception_false_premise',
    subject: 'Discrete Mathematics',
    subjectCode: 'CIT121',
    topic: 'Conditional Statements',
    question: 'Under what condition is the implication P -> Q false?',
    studentAnswer: 'when both P and Q are false',
    expectedPass: false,
    expectedScore: 0.0,
    expectedMisconception: 'Believed false premise implies false outcome',
    expectedCategory: 'math'
  },
  {
    id: 'math_imp_alternative_terminology',
    subject: 'Discrete Mathematics',
    subjectCode: 'CIT121',
    topic: 'Conditional Statements',
    question: 'Under what condition is the implication P -> Q false?',
    studentAnswer: 'antecedent is true and consequent is false',
    expectedPass: true,
    expectedScore: 1.0,
    expectedMisconception: null,
    expectedCategory: 'math'
  },
  {
    id: 'math_imp_clarification_question',
    subject: 'Discrete Mathematics',
    subjectCode: 'CIT121',
    topic: 'Conditional Statements',
    question: 'Under what condition is the implication P -> Q false?',
    studentAnswer: 'Wait, what is the difference between an antecedent and a hypothesis?',
    expectedPass: false,
    expectedClarification: true,
    expectedScore: 0.0,
    expectedCategory: 'clarification'
  },
  {
    id: 'math_equiv_correct',
    subject: 'Discrete Mathematics',
    subjectCode: 'CIT121',
    topic: 'Equivalence Relations',
    question: 'What three properties must a relation satisfy to be an equivalence relation?',
    studentAnswer: 'reflexive, symmetric, and transitive',
    expectedPass: true,
    expectedScore: 1.0,
    expectedCategory: 'math'
  },
  {
    id: 'math_equiv_false_keyword_trap',
    subject: 'Discrete Mathematics',
    subjectCode: 'CIT121',
    topic: 'Equivalence Relations',
    question: 'What three properties must a relation satisfy to be an equivalence relation?',
    studentAnswer: 'An equivalence relation is reflexive, asymmetric, and transitive',
    expectedPass: false,
    expectedScore: 0.0,
    expectedCategory: 'math'
  },

  // 2. Physics & Electronics
  {
    id: 'physics_ohms_correct_spaced',
    subject: 'Basic Electronics',
    subjectCode: 'ELX111',
    topic: 'Ohm\'s Law',
    question: 'If resistance is 10 ohms and current is 2 amperes, calculate the voltage. [Answer: 20V]',
    studentAnswer: '20 V',
    expectedPass: true,
    expectedScore: 1.0,
    expectedCategory: 'calculation'
  },
  {
    id: 'physics_ohms_unit_mismatch',
    subject: 'Basic Electronics',
    subjectCode: 'ELX111',
    topic: 'Ohm\'s Law',
    question: 'If resistance is 10 ohms and current is 2 amperes, calculate the voltage. [Answer: 20V]',
    studentAnswer: '20 A',
    expectedPass: false,
    expectedScore: 0.5,
    expectedMisconception: 'Incorrect unit of measurement',
    expectedCategory: 'calculation'
  },
  {
    id: 'physics_ohms_calc_error',
    subject: 'Basic Electronics',
    subjectCode: 'ELX111',
    topic: 'Ohm\'s Law',
    question: 'If resistance is 10 ohms and current is 2 amperes, calculate the voltage. [Answer: 20V]',
    studentAnswer: '15 V',
    expectedPass: false,
    expectedScore: 0.0,
    expectedCategory: 'calculation'
  },
  {
    id: 'physics_kcl_definition',
    subject: 'Basic Electronics',
    subjectCode: 'ELX111',
    topic: 'Kirchhoff\'s Laws',
    question: 'What does Kirchhoff\'s Current Law (KCL) state regarding a junction or node in a circuit?',
    studentAnswer: 'The sum of all currents entering a junction equals the sum of currents leaving the junction',
    expectedPass: true,
    expectedScore: 1.0,
    expectedCategory: 'physics'
  },
  {
    id: 'physics_kcl_false_statement_with_keywords',
    subject: 'Basic Electronics',
    subjectCode: 'ELX111',
    topic: 'Kirchhoff\'s Laws',
    question: 'What does Kirchhoff\'s Current Law (KCL) state regarding a junction or node in a circuit?',
    studentAnswer: 'KCL states that current splits equally across every junction and voltage remains constant throughout all resistors',
    expectedPass: false,
    expectedScore: 0.0,
    expectedCategory: 'physics'
  },

  // 3. Programming & Data Structures
  {
    id: 'prog_linked_list_correct_pointer',
    subject: 'Data Structures and Algorithms',
    subjectCode: 'CIT214',
    topic: 'Singly Linked List Insertion',
    question: 'When inserting a new node at the beginning of a singly linked list, which pointer must be updated first: newNode->next or the head pointer? Why?',
    studentAnswer: 'newNode->next = head must be updated first so we do not lose reference to the rest of the list',
    expectedPass: true,
    expectedScore: 1.0,
    expectedCategory: 'code'
  },
  {
    id: 'prog_linked_list_orphan_misconception',
    subject: 'Data Structures and Algorithms',
    subjectCode: 'CIT214',
    topic: 'Singly Linked List Insertion',
    question: 'When inserting a new node at the beginning of a singly linked list, which pointer must be updated first: newNode->next or the head pointer? Why?',
    studentAnswer: 'We must update head = newNode first before setting next pointer',
    expectedPass: false,
    expectedScore: 0.0,
    expectedMisconception: 'Orphaned list pointer',
    expectedCategory: 'code'
  },
  {
    id: 'prog_complexity_binary_search',
    subject: 'Data Structures and Algorithms',
    subjectCode: 'CIT214',
    topic: 'Search Algorithms',
    question: 'What is the worst-case time complexity of binary search on a sorted array of size n?',
    studentAnswer: 'O(log n)',
    expectedPass: true,
    expectedScore: 1.0,
    expectedCategory: 'code'
  },
  {
    id: 'prog_complexity_linear_search',
    subject: 'Data Structures and Algorithms',
    subjectCode: 'CIT214',
    topic: 'Search Algorithms',
    question: 'What is the worst-case time complexity of linear search?',
    studentAnswer: 'O(n)',
    expectedPass: true,
    expectedScore: 1.0,
    expectedCategory: 'code'
  },
  {
    id: 'prog_adt_definition',
    subject: 'Data Structures and Algorithms',
    subjectCode: 'CIT214',
    topic: 'Abstract Data Types',
    question: 'Why is an Abstract Data Type (ADT) concerned only with what operations do rather than how they are implemented?',
    studentAnswer: 'Because ADT defines the public interface and behavior while hiding the internal memory implementation details from the user',
    expectedPass: true,
    expectedScore: 1.0,
    expectedCategory: 'code'
  },
  {
    id: 'prog_adt_misconception_hardware',
    subject: 'Data Structures and Algorithms',
    subjectCode: 'CIT214',
    topic: 'Abstract Data Types',
    question: 'Why is an Abstract Data Type (ADT) concerned only with what operations do rather than how they are implemented?',
    studentAnswer: 'ADT is directly tied to the CPU hardware registers and physical memory bus architectures',
    expectedPass: false,
    expectedScore: 0.0,
    expectedCategory: 'code'
  },

  // 4. Computer Networks
  {
    id: 'net_udp_vs_tcp_correct',
    subject: 'Computer Networks',
    subjectCode: 'CIT223',
    topic: 'Transport Layer Protocols',
    question: 'Why is UDP preferred over TCP for live video streaming and DNS queries?',
    studentAnswer: 'UDP is connectionless and has lower latency with no handshake overhead, even though delivery is not guaranteed',
    expectedPass: true,
    expectedScore: 1.0,
    expectedCategory: 'concept'
  },
  {
    id: 'net_udp_CRITICAL_FALSE_KEYWORD_TRAP',
    subject: 'Computer Networks',
    subjectCode: 'CIT223',
    topic: 'Transport Layer Protocols',
    question: 'Why is UDP preferred over TCP for live video streaming and DNS queries?',
    studentAnswer: 'UDP is preferred because it guarantees packet delivery and automatically retransmits dropped segments using sliding windows',
    expectedPass: false,
    expectedScore: 0.0,
    expectedMisconception: 'False attribution of TCP reliability mechanisms to UDP',
    expectedCategory: 'concept'
  },
  {
    id: 'net_osi_transport_layer',
    subject: 'Computer Networks',
    subjectCode: 'CIT223',
    topic: 'OSI Reference Model',
    question: 'Which OSI layer is responsible for end-to-end communication, port addressing, and segment flow control?',
    studentAnswer: 'transport layer',
    expectedPass: true,
    expectedScore: 1.0,
    expectedCategory: 'concept'
  },
  {
    id: 'net_osi_layer_confusion',
    subject: 'Computer Networks',
    subjectCode: 'CIT223',
    topic: 'OSI Reference Model',
    question: 'Which OSI layer is responsible for end-to-end communication, port addressing, and segment flow control?',
    studentAnswer: 'network layer',
    expectedPass: false,
    expectedScore: 0.0,
    expectedMisconception: 'Confused network layer with transport layer',
    expectedCategory: 'concept'
  },
  {
    id: 'net_tcp_handshake_sequence',
    subject: 'Computer Networks',
    subjectCode: 'CIT223',
    topic: 'Transmission Control Protocol',
    question: 'What is the three-way handshake message sequence used to establish a TCP connection?',
    studentAnswer: 'SYN, SYN-ACK, ACK',
    expectedPass: true,
    expectedScore: 1.0,
    expectedCategory: 'concept'
  },

  // 5. Database Systems
  {
    id: 'db_3nf_transitive',
    subject: 'Database Management Systems',
    subjectCode: 'CIT213',
    topic: 'Relational Normalization',
    question: 'What specific type of dependency does Third Normal Form (3NF) eliminate that was permitted in 2NF?',
    studentAnswer: 'transitive dependency',
    expectedPass: true,
    expectedScore: 1.0,
    expectedCategory: 'sql'
  },
  {
    id: 'db_2nf_partial',
    subject: 'Database Management Systems',
    subjectCode: 'CIT213',
    topic: 'Relational Normalization',
    question: 'What specific type of dependency does Second Normal Form (2NF) eliminate?',
    studentAnswer: 'partial dependency on candidate key',
    expectedPass: true,
    expectedScore: 1.0,
    expectedCategory: 'sql'
  },
  {
    id: 'db_3nf_misconception_repeating_groups',
    subject: 'Database Management Systems',
    subjectCode: 'CIT213',
    topic: 'Relational Normalization',
    question: 'What specific type of dependency does Third Normal Form (3NF) eliminate that was permitted in 2NF?',
    studentAnswer: '3NF eliminates repeating groups and ensures atomic columns',
    expectedPass: false,
    expectedScore: 0.0,
    expectedMisconception: 'Confused 3NF with 1NF requirements',
    expectedCategory: 'sql'
  },
  {
    id: 'db_sql_valid_query',
    subject: 'Database Management Systems',
    subjectCode: 'CIT213',
    topic: 'SQL Queries',
    question: 'Write a SQL query to select the student name and marks from the students table for marks above 40.',
    studentAnswer: 'SELECT name, marks FROM students WHERE marks > 40',
    expectedPass: true,
    expectedScore: 1.0,
    expectedCategory: 'sql'
  },
  {
    id: 'db_sql_missing_select_clause',
    subject: 'Database Management Systems',
    subjectCode: 'CIT213',
    topic: 'SQL Queries',
    question: 'Write a SQL query to select the student name and marks from the students table for marks above 40.',
    studentAnswer: 'FROM students WHERE marks > 40',
    expectedPass: false,
    expectedScore: 0.0,
    expectedCategory: 'sql'
  },

  // 6. MCQ Evaluation
  {
    id: 'mcq_correct_option',
    subject: 'Data Structures and Algorithms',
    subjectCode: 'CIT214',
    topic: 'Search Complexities',
    question: 'What is the time complexity of searching in a balanced Binary Search Tree?\nA) O(1)\nB) O(log n)\nC) O(n)\nD) O(n log n)\n[Answer: B]',
    studentAnswer: 'B',
    expectedPass: true,
    expectedScore: 1.0,
    expectedCategory: 'mcq'
  },
  {
    id: 'mcq_incorrect_option',
    subject: 'Data Structures and Algorithms',
    subjectCode: 'CIT214',
    topic: 'Search Complexities',
    question: 'What is the time complexity of searching in a balanced Binary Search Tree?\nA) O(1)\nB) O(log n)\nC) O(n)\nD) O(n log n)\n[Answer: B]',
    studentAnswer: 'Option C',
    expectedPass: false,
    expectedScore: 0.0,
    expectedCategory: 'mcq'
  },

  // 7. Off-Topic & Nonsense Rejection
  {
    id: 'nonsense_completely_off_topic',
    subject: 'Discrete Mathematics',
    subjectCode: 'CIT121',
    topic: 'Propositional Logic',
    question: 'Under what condition is P -> Q false?',
    studentAnswer: 'the weather in pokhara today is sunny and beautiful with mountains',
    expectedPass: false,
    expectedScore: 0.0,
    expectedCategory: 'concept'
  },
  {
    id: 'nonsense_prompt_keyword_echo',
    subject: 'Discrete Mathematics',
    subjectCode: 'CIT121',
    topic: 'Propositional Logic',
    question: 'Under what condition is P -> Q false?',
    studentAnswer: 'The condition under which the implication is false is false condition',
    expectedPass: false,
    expectedScore: 0.0,
    expectedCategory: 'concept'
  }
];

function runBenchmark() {
  console.log(`Running Teaching Intelligence Baseline Benchmark across ${TEST_SCENARIOS.length} scenarios...\n`);

  let passedTests = 0;
  let failedTests = 0;
  const failureDetails = [];

  for (const s of TEST_SCENARIOS) {
    const result = evaluateAcademicAnswer(s.studentAnswer, {
      topicTitle: s.topic,
      subject: s.subject,
      subjectCode: s.subjectCode
    }, s.question);

    let testMatches = true;
    const failures = [];

    // Check pass/fail match
    if (result.passed !== s.expectedPass) {
      testMatches = false;
      failures.push(`Expected passed=${s.expectedPass}, got ${result.passed}`);
    }

    // Check score match (if specified)
    if (s.expectedScore !== undefined && Math.abs((result.score ?? (result.passed ? 1.0 : 0.0)) - s.expectedScore) > 0.05) {
      testMatches = false;
      failures.push(`Expected score=${s.expectedScore}, got ${result.score}`);
    }

    // Check clarification match (if expected)
    if (s.expectedClarification && !result.isClarification) {
      testMatches = false;
      failures.push(`Expected isClarification=true, got ${Boolean(result.isClarification)}`);
    }

    if (testMatches) {
      passedTests++;
      console.log(`  ✔ [PASS] ${s.id} (${s.subjectCode} - ${s.topic})`);
    } else {
      failedTests++;
      console.log(`  ✖ [FAIL] ${s.id} (${s.subjectCode} - ${s.topic}): ${failures.join('; ')}`);
      failureDetails.push({
        id: s.id,
        scenario: s,
        actual: result,
        failures
      });
    }
  }

  console.log(`\n======================================================`);
  console.log(`BENCHMARK SUMMARY:`);
  console.log(`Total: ${TEST_SCENARIOS.length} | Passed: ${passedTests} | Failed: ${failedTests}`);
  console.log(`Accuracy Rate: ${((passedTests / TEST_SCENARIOS.length) * 100).toFixed(1)}%`);
  console.log(`======================================================\n`);

  if (failureDetails.length > 0) {
    console.log(`DETAILED FAILURES:`);
    for (const f of failureDetails) {
      console.log(`- ${f.id}:`);
      console.log(`  Question: "${f.scenario.question}"`);
      console.log(`  Student Answer: "${f.scenario.studentAnswer}"`);
      console.log(`  Failures: ${f.failures.join(', ')}`);
      console.log(`  Actual output:`, JSON.stringify(f.actual));
    }
  }

  return { total: TEST_SCENARIOS.length, passed: passedTests, failed: failedTests, failureDetails };
}

if (require.main === module) {
  runBenchmark();
}

module.exports = { TEST_SCENARIOS, runBenchmark };
