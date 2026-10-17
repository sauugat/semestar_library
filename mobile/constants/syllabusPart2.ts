import { SyllabusSemester } from './syllabusTypes';

export const SEMESTERS_PART_2: SyllabusSemester[] = [
  {
    id: 'sem-3',
    semesterNumber: 3,
    semesterRoman: 'III',
    year: 'Year 2',
    yearNumber: 2,
    title: 'Year 2 · Semester III',
    shortTitle: 'Semester III',
    totalCredits: 19,
    totalCourses: 6,
    description: 'Advanced web technologies, microprocessor & computer architecture, software engineering, relational database systems, data structures & algorithms, and organization management.',
    courses: [
      {
        code: 'CIT211',
        title: 'Web Technology II',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH + PR',
        totalHours: '45 hrs',
        year: 'Year 2',
        semester: 'III',
        objectives: [
          'Enhance students’ knowledge of advanced frontend and backend web application development, asynchronous programming, database integration, and web security.',
        ],
        outcomes: [
          'Build modern frontend and backend web applications using responsive CSS, AJAX, XML, JSON, ES6+ JavaScript, and MVC frameworks.',
          'Identify common cyber-attacks (XSS, SQL Injection) and apply web security mechanisms.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Introduction',
            hours: '2 hrs',
            topics: [
              '1.1 Introduction to Web 1.0, 2.0, 3.0',
              '1.2 Introduction to Web Servers: Apache and IIS, XAMPP, WAMP, Handling HTTP Request and Response, Server Installation',
              '1.3 Review of HTML5, XHTML, CSS3 and their roles in web development',
            ],
          },
          {
            unitNumber: 2,
            title: 'Styling More with CSS',
            hours: '5 hrs',
            topics: [
              '2.1 CSS Selectors, CSS Properties and Values, Browser Compatibility',
              '2.2 Dynamic vs. Static Web Pages',
              '2.3 Page layout techniques (Normal flow, display property, Flexbox, Grid, Floats, Positioning, Table layout, Multi-column layout)',
              '2.4 Designing responsive web pages, Media queries',
              '2.5 Introduction to Bootstrap and its advantages',
            ],
          },
          {
            unitNumber: 3,
            title: 'AJAX and XML',
            hours: '8 hrs',
            topics: [
              '3.1 Basics of AJAX and asynchronous programming',
              '3.2 Introduction to XML, Advantages and Applications, Syntax and Rules, XML Elements, Attributes, XML Tree, XML Namespace, Document Type Definition (DTD)',
              '3.3 XML Schema Definition (XSD), XSL/XSLT, XQuery, XPath, Simple API for XML (SAX), XML DOM',
            ],
          },
          {
            unitNumber: 4,
            title: 'Advanced JavaScript',
            hours: '12 hrs',
            topics: [
              '4.1 Introduction to JSON, Introduction to jQuery',
              '4.2 Variables, scope, let, const, and var keywords',
              '4.3 Iteration: for-of loops (ES6), for-await-of loops (ES2018), for-in loops, forEach array methods',
              '4.4 Object Literals, Constructors, and Object-Oriented JavaScript',
              '4.5 Classes and Inheritance in JavaScript',
              '4.6 Callback functions in JavaScript',
              '4.7 Promises Basics, promise.then() & promise.catch()',
              '4.8 Arrow functions in JavaScript, getters and setters',
              '4.9 Fetch API and Async/Await in JavaScript',
            ],
          },
          {
            unitNumber: 5,
            title: 'Web Security',
            hours: '5 hrs',
            topics: [
              'Cryptography, Authentication, Encryption/Decryption, Digital Certificates, Digital Signatures, SSL/TLS',
              'Web Attacks: Cross-Site Scripting (XSS), SQL Injection, and countermeasures',
            ],
          },
          {
            unitNumber: 6,
            title: 'Combining Together',
            hours: '5 hrs',
            topics: [
              'Creating the Database, Establishing the Site, Coding the Non-JavaScript Version, Creating AJAX Resources, Adding JavaScript, Securing the Site',
            ],
          },
          {
            unitNumber: 7,
            title: 'Web Application Development Frameworks',
            hours: '8 hrs',
            topics: [
              'Introduction to CMS, MVC Architecture, Unit Testing, Introduction to Modern Web Frameworks, Case Studies on popular frameworks',
            ],
          },
        ],
        laboratoryWork: [
          'Practical exercises covering every unit: responsive Flexbox/Grid/Bootstrap layouts, XML/XSD/AJAX, ES6+ Async/Await & Fetch API, and web security.',
          'Individual or group project to develop a full-stack web application evaluated by an external examiner assigned by the Department.',
        ],
        references: [
          'Jeffrey C. Jackson, "Web Technologies: A Computer Science Perspective", Pearson.',
          'P.J. Deitel and H.M. Deitel, "Internet and World Wide Web: How to Program", 5th Edition, Pearson.',
          'Dafydd Stuttard and Marcus Pinto, "The Web Application Hacker’s Handbook", 2nd Edition, Wiley.',
          'Larry Ullman, "Modern JavaScript: Develop and Design".',
          'Thomas A. Powell, "HTML & CSS: The Complete Reference", 5th Edition, McGraw-Hill.',
          'Robin Nixon, "Learning PHP, MySQL & JavaScript With jQuery, CSS & HTML5", 4th Edition, O’Reilly.',
          'Eric Newcomer, "Understanding Web Services: XML, WSDL, SOAP, and UDDI", Addison-Wesley.',
        ],
      },
      {
        code: 'ELX211',
        title: 'Microprocessor and Computer Architecture',
        credit: 4,
        creditDisplay: '4',
        nature: 'TH + PR',
        totalHours: '60 hrs',
        year: 'Year 2',
        semester: 'III',
        objectives: [
          'Provide fundamental knowledge of microprocessor components, block diagrams, assembly language programming (Intel 8085 & 8086), SAP-I/SAP-II architecture, CPU organization, RISC/CISC, memory hierarchy, DMA, and parallel processing.',
        ],
        description:
          'An introduction to microprocessor and computer architecture covering instruction cycles, Intel 8085 and 8086 microprocessors, assembly language programming, control unit design, computer arithmetic, memory organization, pipelining, and parallel processing.',
        outcomes: [
          'Understand microprocessor fundamentals and internal architectures of Intel 8085 and 8086.',
          'Write and debug assembly language programs.',
          'Interface peripheral devices such as keyboards and seven-segment displays and handle interrupts.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Fundamental of Microprocessor',
            hours: '6 hrs',
            topics: [
              'Introduction and History of Microprocessors, Microprocessor system with Bus organization',
              'Components of a Microprocessor: Registers, ALU, Control and Timing',
              'Introduction to SAP-I and SAP-II with architecture, Applications of Microprocessors',
            ],
          },
          {
            unitNumber: 2,
            title: 'Intel 8085',
            hours: '10 hrs',
            topics: [
              'Functional Block Diagram and Pin Configuration, Features of 8085, Timing and Control Unit, Registers, Data and Address Bus',
              'Intel 8085 Instruction sets, Opcode and Operands, Addressing Modes, Interrupts, Flags',
              'Assembly Language Programming with 8085 microprocessor',
            ],
          },
          {
            unitNumber: 3,
            title: 'Overview of Intel 8086',
            hours: '5 hrs',
            topics: [
              'Block Diagram and Pin Configuration, Features and comparison with 8085',
              'Introduction to 8086 instructions, Addressing Modes, Introduction to 8086 Assembly Language programming',
            ],
          },
          {
            unitNumber: 4,
            title: 'Basic Computer Architecture and Microoperations',
            hours: '5 hrs',
            topics: [
              'History of Computer Architecture, Overview of Computer Organization, Memory Hierarchy',
              'Microoperations: Arithmetic, Logic, and Shift Microoperations, Arithmetic Logic Shift Unit (ALSU)',
            ],
          },
          {
            unitNumber: 5,
            title: 'Control Unit and Central Processing Unit',
            hours: '8 hrs',
            topics: [
              'CPU organization, Register organization, Instruction cycle, Control Unit of Basic Computer',
              'Microinstruction and Microoperation format, Symbolic Microinstructions and Microprogram',
              'Data Transfer and Manipulation, Introduction to RISC and CISC',
            ],
          },
          {
            unitNumber: 6,
            title: 'Computer Arithmetic',
            hours: '6 hrs',
            topics: [
              'Data Representation, Integer Arithmetic, Addition/Subtraction',
              "Multiplication (Unsigned, Booth's Algorithm), Division, Floating-point Representation",
            ],
          },
          {
            unitNumber: 7,
            title: 'Input and Output Organization',
            hours: '5 hrs',
            topics: [
              'Introduction to Peripheral Devices, I/O Interface, Direct Memory Access (DMA), I/O Processor, Data Communication Processor',
            ],
          },
          {
            unitNumber: 8,
            title: 'Memory Organization',
            hours: '5 hrs',
            topics: [
              'Hierarchy of Memory System, Primary and Secondary Memory, Virtual Memory',
              'Cache Memory and Mapping techniques, Memory Management Hardware',
            ],
          },
          {
            unitNumber: 9,
            title: 'Pipelining',
            hours: '5 hrs',
            topics: [
              'Concept of Pipelining, Arithmetic Pipeline, Instruction Pipeline, Data Dependency, Handling of Branch Instructions',
            ],
          },
          {
            unitNumber: 10,
            title: 'Parallel Processing',
            hours: '5 hrs',
            topics: [
              "Parallel Processing, Parallelism in Multiprocessor Systems, Flynn's Classification, Interconnection structures, Vector Arithmetic Unit, Multithreaded Structure",
            ],
          },
        ],
        laboratoryWork: [
          'Assembly language programming using Intel 8085 trainer kit / simulator covering data transfer, arithmetic operations, logic operations, conditional branching, and base conversion.',
        ],
        textbooks: [
          'Ramesh S. Gaonkar, "Microprocessor Architecture, Programming, and Applications with the 8085", Prentice Hall.',
          'M. Morris Mano, "Computer System Architecture", 3rd Edition, Prentice Hall.',
        ],
        references: [
          'Albert Paul Malvino, "Digital Computer Electronics: An Introduction to Microcomputers".',
          'Douglas V. Hall, "Microprocessors and Interfacing: Programming and Hardware", McGraw-Hill.',
        ],
      },
      {
        code: 'CIT212',
        title: 'Software Engineering',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH + PR',
        totalHours: '45 hrs',
        year: 'Year 2',
        semester: 'III',
        objectives: [
          'Introduce a systematic approach to planning, designing, implementing, testing, and maintaining software products using agile practices, system modeling, architectural patterns, quality assurance, and configuration management.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Software Engineering Fundamentals',
            hours: '4 hrs',
            topics: [
              '1.1 Professional software products',
              '1.2 Software engineering diversity',
              '1.3 Unified Process',
              '1.4 Software engineering ethics',
            ],
          },
          {
            unitNumber: 2,
            title: 'Agile Software Development',
            hours: '5 hrs',
            topics: [
              '2.1 Agile methods',
              '2.2 Plan-driven and agile development',
              '2.3 Extreme Programming (XP)',
              '2.4 Scrum methodology',
              '2.5 Agile project management',
            ],
          },
          {
            unitNumber: 3,
            title: 'Requirement Engineering',
            hours: '5 hrs',
            topics: [
              '3.1 Functional and non-functional requirements',
              '3.2 Software Requirement Specification (SRS) documents',
              '3.3 Requirement engineering process',
              '3.4 Requirements management',
              '3.5 Business/Domain Modeling',
              '3.6 Business Process Reengineering (BPR)',
            ],
          },
          {
            unitNumber: 4,
            title: 'System Modeling',
            hours: '6 hrs',
            topics: [
              '4.1 Context models',
              '4.2 Interaction models',
              '4.3 Structural models',
              '4.4 Behavioral models',
              '4.5 Package Structure',
            ],
          },
          {
            unitNumber: 5,
            title: 'Architectural Design',
            hours: '5 hrs',
            topics: [
              '5.1 Architectural design decisions',
              '5.2 Model-View-Controller (MVC) architectural pattern',
              '5.3 Layered architectural pattern',
              '5.4 Client-server architecture',
            ],
          },
          {
            unitNumber: 6,
            title: 'Design, Reuse and Implementation',
            hours: '5 hrs',
            topics: [
              '6.1 Use case realizations',
              '6.2 Mapping designs to code',
              '6.3 Design patterns',
              '6.4 Implementation issues',
              '6.5 Open-source development',
            ],
          },
          {
            unitNumber: 7,
            title: 'Software Testing and Cost Estimation',
            hours: '5 hrs',
            topics: [
              '7.1 System testing',
              '7.2 Component testing',
              '7.3 Test case design',
              '7.4 Test automation',
              '7.5 Estimation techniques',
              '7.6 Project duration and staffing',
            ],
          },
          {
            unitNumber: 8,
            title: 'Quality Management',
            hours: '6 hrs',
            topics: [
              '8.1 Quality concepts',
              '8.2 Software Quality Assurance (SQA)',
              '8.3 Software reliability',
              '8.4 Software maintenance',
              '8.5 ISO standards & 8.6 CMMI',
              '8.7 SQA plan & 8.8 Software certification',
            ],
          },
          {
            unitNumber: 9,
            title: 'Configuration Management',
            hours: '4 hrs',
            topics: [
              '9.1 Configuration management planning',
              '9.2 Change management',
              '9.3 Version and release management',
              '9.4 CASE tools for configuration management',
            ],
          },
        ],
        laboratoryWork: [
          'Development of user requirements and corresponding system requirement specifications (SRS).',
          'Introduction to a standard Integrated Development Environment (IDE) such as Eclipse and its features.',
          'UML diagrams for a project/case study using open-source tools (e.g., sequencediagram.org).',
          'Understanding program flow and code structure of MVC architecture through an open-source framework.',
          'Implementation of design patterns such as Singleton, Factory, etc.',
          'Implementation of source code management using Git.',
        ],
        textbooks: ['Ian Sommerville, "Software Engineering", 10th Edition, Pearson, 2016.'],
        references: [
          'Roger S. Pressman, "Software Engineering: A Practitioner’s Approach", McGraw-Hill, 2005.',
          'C. Ghezzi, M. Jazayeri, and D. Mandrioli, "Fundamentals of Software Engineering", Prentice Hall, 2003.',
          'Craig Larman, "Applying UML and Patterns", 3rd Edition, Prentice Hall, 2005.',
        ],
      },
      {
        code: 'CIT213',
        title: 'Database Management System',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH + PR',
        totalHours: '45 hrs',
        year: 'Year 2',
        semester: 'III',
        note: 'Includes 45 hours of theory and a mandatory 10-exercise SQL/DBMS laboratory component plus group project.',
        objectives: [
          'Provide fundamental concepts and understanding of database systems, data modeling, relational algebra, SQL, normalization, transaction processing, recovery, and NoSQL databases.',
        ],
        outcomes: [
          'Understand database management system architectures and data models.',
          'Write complex SQL queries (DDL, DML, DCL, TCL, views, triggers, joins, subqueries).',
          'Apply functional dependencies and normal forms (1NF, 2NF, 3NF, BCNF, 4NF, 5NF) to design normalized relational databases.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Introduction',
            hours: '5 hrs',
            topics: [
              'Introduction to database and DBMS, Characteristics and applications of DBMS',
              'Data Abstraction and Data Independence, Database users and Database Administrator (DBA)',
              'Application Architecture, Basics of Database Languages (DDL, DML, DCL)',
            ],
          },
          {
            unitNumber: 2,
            title: 'Data Model',
            hours: '6 hrs',
            topics: [
              'Conceptual, physical, and logical data models; E-R Model, Network/Hierarchical Model, Relational Model, Object-Oriented Model',
              'Entities, Entity Sets (Strong and Weak), Relationships, Attributes and Keys (Primary, Candidate, Super Key)',
              'E-R Diagram, Reducing E-R Diagram to tables, Generalization, Specialization, Aggregation, Mapping Cardinalities, Extended E-R Features',
            ],
          },
          {
            unitNumber: 3,
            title: 'Relational Model',
            hours: '4 hrs',
            topics: [
              'Introduction to Relational Database, Database Schema and Views',
              'Relational Model Constraints, Relational Operations, Relational Algebra',
            ],
          },
          {
            unitNumber: 4,
            title: 'Relational Language and Database Constraints',
            hours: '11 hrs',
            topics: [
              'Structured Query Language (SQL): Features, SQL queries and subqueries, Joined and Derived Relations',
              'DDL and DML Operations, Views, Database modification, Join conditions and categories',
              'Transaction Control Language (Commit, Rollback), Integrity Constraints, Domain Constraints, Referential Integrity, Assertions, and Triggers',
            ],
          },
          {
            unitNumber: 5,
            title: 'Relational Database Design',
            hours: '7 hrs',
            topics: [
              'Features of good database design, Functional dependencies, Decomposition using functional dependencies',
              'Multi-valued and joined dependencies, Normalization, Normal Forms (1NF, 2NF, 3NF, BCNF, 4NF, 5NF)',
            ],
          },
          {
            unitNumber: 6,
            title: 'Transaction Management and Concurrency Control',
            hours: '5 hrs',
            topics: [
              'Concept of Transaction, ACID properties, Transaction Atomicity and Durability',
              'Concurrency Control and Recovery, Serializability, Lock-based Protocols, Timestamp-based Protocols',
            ],
          },
          {
            unitNumber: 7,
            title: 'Recovery System',
            hours: '3 hrs',
            topics: [
              'Basic concept of Crash Recovery, Classification of failure, Recovery and Atomicity, Log-based recovery, Shadow paging',
            ],
          },
          {
            unitNumber: 8,
            title: 'Advanced Database Model',
            hours: '4 hrs',
            topics: [
              'Extension of Relational Model, Object-Oriented Model, Distributed Database Model, NoSQL Systems, XML Database',
            ],
          },
        ],
        laboratoryWork: [
          'Minimum 10 laboratory exercises covering database server installation (MySQL / MS-Access), schema creation, constraints, DDL/DML/TCL commands, joins, subqueries, views, and triggers, plus a group database project.',
        ],
        references: [
          'Abraham Silberschatz, Henry F. Korth, and S. Sudarshan, "Database System Concepts", 7th Edition, McGraw-Hill.',
          'Ramez Elmasri and Shamkant B. Navathe, "Fundamentals of Database Systems", Pearson Education Asia.',
          'Raghu Ramakrishnan and Johannes Gehrke, "Database Management Systems", Tata McGraw-Hill.',
          'Pramod J. Sadalage and Martin Fowler, "NoSQL Distilled: A Brief Guide to the Emerging World of Polyglot Persistence", Pearson.',
        ],
      },
      {
        code: 'CIT214',
        title: 'Data Structure and Algorithms',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH + PR',
        totalHours: '45 hrs',
        year: 'Year 2',
        semester: 'III',
        objectives: [
          'Provide theoretical and practical knowledge of data structures and algorithms required to design and analyze efficient computer programs.',
        ],
        description:
          'A rigorous course on data structures and associated algorithms covering linked lists, stacks, queues, recursion, trees, graphs, sorting, searching, hashing, and asymptotic complexity analysis.',
        outcomes: [
          'Select and implement appropriate data structures and algorithms for problem solving.',
          'Analyze time and space complexity using asymptotic notations and design efficient algorithms.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Introduction',
            hours: '5 hrs',
            topics: [
              '1.1 Overview of Data Structures and Algorithms, Object-Oriented Programming, Software Engineering',
              '1.2 Abstract Data Types (ADT), Review of Arrays, Structures, and Pointers',
              '1.3 Algorithm Complexity (Time and Space Complexity), Asymptotic Notations (Big-O, Omega, Theta), Time-Space Tradeoff',
            ],
          },
          {
            unitNumber: 2,
            title: 'Linked Lists',
            hours: '5 hrs',
            topics: [
              '2.1 Linked List as an ADT',
              '2.2 Singly Linked Lists: Insertion, Deletion, Search',
              '2.3 Doubly (Two-Way) Linked Lists: Insertion, Deletion, Search',
              '2.4 Circular Linked List',
            ],
          },
          {
            unitNumber: 3,
            title: 'Stacks, Queue and Recursion',
            hours: '10 hrs',
            topics: [
              '3.1 Stack and Queue as an ADT',
              '3.2 Array and Linked List Implementation of Stack and Queue',
              '3.3 Expression Conversion and Evaluation of Infix, Postfix, and Prefix Expressions',
              '3.4 Circular Queue and its Implementation',
              '3.5 Applications of Stack and Queue',
              '3.6 Recursion, Recursion vs. Iteration, Tail vs. Non-tail Recursion, Indirect Recursion, Tower of Hanoi, Backtracking, Efficiency of Recursion',
            ],
          },
          {
            unitNumber: 4,
            title: 'Trees',
            hours: '7 hrs',
            topics: [
              '4.1 Introduction to Trees, Basic Concepts and Terminology (Height, Level, Depth, Path, Root, Parent, Child, Leaf, Node, Subtree, Keys)',
              '4.2 Binary Trees, Tree Traversal (Inorder, Preorder, Postorder), Efficiency of Binary Trees',
              '4.3 Binary Search Tree (BST), BST Operations (Insertion, Deletion, Search)',
              '4.4 Heaps and Priority Queue Operations',
              '4.5 AVL Balanced Trees and Rotations',
              '4.6 M-Way Search Trees, B-Tree and B+ Tree Operations',
              '4.7 Splay Tree',
              '4.8 Application of Trees: Huffman Coding',
            ],
          },
          {
            unitNumber: 5,
            title: 'Sorting',
            hours: '6 hrs',
            topics: [
              '5.1 Introduction to Sorting, Sorting Types (Internal vs. External)',
              '5.2 Elementary Sorting Algorithms: Insertion Sort, Selection Sort, Bubble Sort',
              '5.3 Divide & Conquer Sorting Algorithms: Heap Sort, Quicksort, Merge Sort',
              '5.4 Efficiency of Sorting Algorithms',
            ],
          },
          {
            unitNumber: 6,
            title: 'Searching and Hashing',
            hours: '4 hrs',
            topics: [
              '6.1 Searching: Linear Search and Binary Search, Search Efficiency',
              '6.2 Hashing: Hash Functions and Hash Tables, Collision Resolution Techniques, Hashing Efficiency',
            ],
          },
          {
            unitNumber: 7,
            title: 'Graph',
            hours: '6 hrs',
            topics: [
              '7.1 Graphs as an ADT, Graph Types, Graph Representation (Adjacency Matrix & List)',
              '7.2 Graph Traversal (BFS & DFS)',
              "7.3 Minimum Spanning Trees (Kruskal's and Prim's Algorithms)",
              "7.4 Single-Source Shortest Paths (Bellman-Ford Algorithm, Dijkstra's Algorithm)",
            ],
          },
          {
            unitNumber: 8,
            title: 'Case Studies in Algorithms',
            hours: '2 hrs',
            topics: [
              '8.1 Investigate classical computer science problems (Traveling Salesman Problem, Shortest Path Problem, Knapsack Problem) using Brute-Force, Greedy, and Dynamic Programming paradigms',
            ],
          },
        ],
        laboratoryWork: [
          'Implementations in an OOP language (C++ or Java):',
          '1. Linked Lists (Singly, Doubly, Circular)',
          '2. Stack and Expression Evaluation',
          '3. Linear and Circular Queue',
          '4. Recursion: Tower of Hanoi and Fibonacci series',
          '5. Balanced Trees (AVL Tree / BST)',
          '6. Elementary Sorting (Insertion, Bubble, Selection)',
          '7. Divide & Conquer Sorting (Heap Sort, Quicksort, Merge Sort)',
          '8. Linear Search and Binary Search',
          '9. Hash Table and Collision Resolution',
          '10. Minimum Spanning Tree (Prim / Kruskal)',
          "11. Shortest Path Algorithm (Dijkstra's Algorithm)",
        ],
        references: [
          'Seymour Lipschutz, "Data Structures", Schaum’s Outlines, McGraw-Hill Education.',
          'Thomas H. Cormen, Charles E. Leiserson, Ronald L. Rivest, and Clifford Stein, "Introduction to Algorithms", MIT Press.',
          'Robert Lafore, "Data Structures & Algorithms in Java", SAMS.',
          'Y. Langsam, M.J. Augenstein, and A.M. Tenenbaum, "Data Structures Using C and C++", Prentice Hall India.',
          'E. Horowitz, S. Sahni, and S. Rajasekaran, "Fundamentals of Computer Algorithms", Galgotia Publications.',
        ],
      },
      {
        code: 'BCT211',
        title: 'Principles of Organization and Management',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH',
        totalHours: '45 hrs',
        year: 'Year 2',
        semester: 'III',
        objectives: [
          'Provide essential knowledge and exposure to management concepts, theories, and practices across planning, organizing, leadership, motivation, communication, and controlling in modern organizations.',
        ],
        outcomes: [
          'Describe fundamental concepts, historical evolution, and principles of management.',
          'Explain managerial roles, organizational design, leadership styles, motivation theories, and control mechanisms.',
          'Apply decision-making tools and functional management strategies in business and IT organizations.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Introduction to Management',
            hours: '4 hrs',
            topics: [
              '1.1 Concept, characteristics, and levels of management; Kinds of managers; Basic management functions (2 hrs)',
              '1.2 Managerial roles and skills; Management as science and art; CSR and Corporate Governance; Skills for today’s managers (2 hrs)',
            ],
          },
          {
            unitNumber: 2,
            title: 'Evolution of Management and the Environmental Context of Management',
            hours: '6 hrs',
            topics: [
              '2.1 Classical, Behavioral, Quantitative, Systems, and Contingency management perspectives (3 hrs)',
              '2.2 Business environment: Concept, characteristics, components, organization-environment interface, emerging management issues (2 hrs)',
              '2.3 Organizational change: Concept and drivers, overcoming employee resistance, Organizational Development (OD) interventions (1 hr)',
            ],
          },
          {
            unitNumber: 3,
            title: 'Planning and Decision Making',
            hours: '6 hrs',
            topics: [
              '3.1 Organizational planning: Concept, features, process, types, and methods; Strategic planning (3 hrs)',
              '3.2 Managerial decision making: Concept, features, process, types, decision making under uncertainty (3 hrs)',
            ],
          },
          {
            unitNumber: 4,
            title: 'Organizing',
            hours: '8 hrs',
            topics: [
              '4.1 Organizing: Concept, elements, and types of organizational design (2 hrs)',
              '4.2 Job Design: Concept, techniques, job specification, and job description (2 hrs)',
              '4.3 Departmentalization: Concept and types; Authority, power, and responsibility (2 hrs)',
              '4.4 Delegation and Decentralization of Authority; Coordinating organizational units (2 hrs)',
            ],
          },
          {
            unitNumber: 5,
            title: 'Motivation and Leadership',
            hours: '6 hrs',
            topics: [
              '5.1 Content perspectives on motivation: Needs-hierarchy theory and Two-factor theory (2 hrs)',
              '5.2 Process perspectives: Expectancy theory, Equity theory, Goal-setting theory, and Reinforcement perspectives (2 hrs)',
              '5.3 Leadership: Nature of leadership; Generic, Situational, and Emerging approaches to leadership (2 hrs)',
            ],
          },
          {
            unitNumber: 6,
            title: 'Communication and Managing Workforce',
            hours: '6 hrs',
            topics: [
              '6.1 Organizational communication: Concept, types, barriers, and methods for effective communication (3 hrs)',
              '6.2 Groups and teams in organizations: Characteristics, interpersonal and inter-group conflict, managing conflict (3 hrs)',
            ],
          },
          {
            unitNumber: 7,
            title: 'Controlling',
            hours: '3 hrs',
            topics: [
              '7.1 Concept, nature, purpose, and process of control; Strategic, structural, operational, and financial control (2 hrs)',
              '7.2 Role of Information Technology in operational and behavioral control (1 hr)',
            ],
          },
          {
            unitNumber: 8,
            title: 'Functional Areas of Management',
            hours: '6 hrs',
            topics: [
              '8.1 Marketing management: Concept, relevance, and components of the marketing mix (2 hrs)',
              '8.2 Human resource management: Concept, functions, succession planning, knowledge and talent management (2 hrs)',
              '8.3 R&D: Business research process, organizational agility, learning organization, corporate entrepreneurship (2 hrs)',
            ],
          },
        ],
        textbooks: [
          'Robbins, S.P., Coulter, M., Viswanathan, R., & Randel, A., "Management", Pearson Education.',
        ],
        references: [
          'Griffin, R.W., "Fundamentals of Management", Cengage Learning Asia.',
          'Tripathi, P.C., Reddy, P.N., & Bajpai, A., "Principles of Management", McGraw-Hill.',
        ],
      },
    ],
  },
  {
    id: 'sem-4',
    semesterNumber: 4,
    semesterRoman: 'IV',
    year: 'Year 2',
    yearNumber: 2,
    title: 'Year 2 · Semester IV',
    shortTitle: 'Semester IV',
    totalCredits: 18,
    totalCourses: 6,
    description: 'Operating systems internals, management information systems, computer networks & security, probability & statistics, 2D/3D computer graphics, and Project II.',
    courses: [
      {
        code: 'CIT221',
        title: 'Operating Systems',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH + PR',
        totalHours: '45 hrs',
        year: 'Year 2',
        semester: 'IV',
        objectives: [
          'Describe the role and architecture of operating systems, analyze process scheduling, synchronization, deadlock handling, memory management, file systems, and I/O management, and simulate OS algorithms.',
        ],
        description:
          'Covers core operating system components including process management, inter-process communication, deadlocks, paging/segmentation memory management, file system implementation, disk scheduling, security, and UNIX/Linux/Windows case studies.',
        outcomes: [
          'Describe computer system and operating system structures and kernel architectures.',
          'Analyze and simulate process scheduling, synchronization, deadlock avoidance, page replacement, and disk scheduling algorithms.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Operating System Overview',
            hours: '4 hrs',
            topics: [
              '1.1 History, Definition, and Functions of OS; OS as Resource Manager and Extended Machine; Evolution and Types of OS',
              '1.2 Operating System Structures: Monolithic, Layered, Microkernel, Virtual Machine',
              '1.3 System Calls, System Programs, Kernel, Shell, Shell Commands, Shell Programming',
              '1.4 Open-Source Operating Systems',
            ],
          },
          {
            unitNumber: 2,
            title: 'Process Management',
            hours: '10 hrs',
            topics: [
              '2.1 Concept of Process, Uniprogramming, Multiprogramming, and Multiprocessing',
              '2.2 Process Model, Process States and Transitions, Process Control Block (PCB)',
              '2.3 Threads, Thread vs. Process, User-level and Kernel-space Threads',
              '2.4 Process Synchronization and Inter-Process Communication (IPC), Race Conditions, Critical Section Problem',
              "2.5 Mutual Exclusion: Busy Waiting (Disabling Interrupts, Lock Variables, Strict Alternation, Peterson's Solution, Test-and-Set Lock), Sleep and Wakeup, Semaphores, Monitors, Message Passing",
              '2.6 Classical IPC Problems: Producer-Consumer, Sleeping Barber, Dining Philosophers, Readers-Writers',
              '2.7 Process Scheduling: FCFS, SJF, SRTN, Round-Robin, Priority, Multiple Queues, HRRN, Real-Time Scheduling',
            ],
          },
          {
            unitNumber: 3,
            title: 'Deadlock',
            hours: '6 hrs',
            topics: [
              '3.1 Definition of Deadlock, Preemptable and Non-preemptable Resources, Necessary Conditions for Deadlock',
              '3.2 Deadlock Prevention, Avoidance, Detection, and Recovery',
              "3.3 Resource Allocation Graph and Banker's Algorithm (Single and Multiple Resource Instances)",
              '3.4 Communication Deadlock, Livelock, Starvation',
            ],
          },
          {
            unitNumber: 4,
            title: 'Memory Management',
            hours: '8 hrs',
            topics: [
              '4.1 Logical vs. Physical Address Space, Swapping, Multiprogramming with Fixed and Variable Partitions',
              '4.2 Memory Management with Bitmaps & Linked Lists; Contiguous and Non-contiguous Allocation',
              '4.3 Virtual Memory: Paging, Page Tables, Page Faults, Demand Paging, Thrashing',
              '4.4 Page Replacement Algorithms: FIFO, LRU, Optimal, Second Chance, Clock Page',
              '4.5 Segmentation, Segmentation with Paging, Segmentation vs. Paging',
            ],
          },
          {
            unitNumber: 5,
            title: 'File Management',
            hours: '6 hrs',
            topics: [
              '5.1 File Naming, Structure, Types, Access, Attributes, and Operations',
              '5.2 Single-Level, Two-Level, and Hierarchical Directory Systems',
              '5.3 File Access Mechanisms: Sequential, Direct, and Indexed',
              '5.4 File Allocation: Contiguous, Linked List, FAT Table, Indexed / i-nodes',
              '5.5 Free Space Management: Bitmaps and Linked Lists',
            ],
          },
          {
            unitNumber: 6,
            title: 'I/O Management',
            hours: '5 hrs',
            topics: [
              '6.1 Principles of I/O Hardware and Software, Controllers, Memory-Mapped I/O, DMA, Interrupts',
              '6.2 Programmed I/O, Interrupt-Driven I/O, I/O using DMA; Interrupt Handlers and Device Drivers',
              '6.3 Disk Structure and Disk Scheduling Algorithms: FCFS, SSTF, SCAN, C-SCAN, LOOK, C-LOOK',
            ],
          },
          {
            unitNumber: 7,
            title: 'Security',
            hours: '3 hrs',
            topics: [
              '7.1 Security Breaches, Types of Attacks, Authentication and Authorization',
              '7.2 Basics of Cryptography, Protection Mechanisms, Access Control Matrix and Access Control Lists (ACLs)',
            ],
          },
          {
            unitNumber: 8,
            title: 'Case Study',
            hours: '3 hrs',
            topics: ['UNIX, Linux, and Windows Operating Systems'],
          },
        ],
        laboratoryWork: [
          '1. Demonstration of basic Shell Commands and Shell Scripting in Linux.',
          '2. Implementation of Linux System Calls (fork, exec, wait, open, read, write).',
          '3. Simulation of CPU Process Scheduling algorithms.',
          '4. Implementation of Producer-Consumer synchronization problem.',
          '5. Simulation of Page Replacement algorithms (FIFO, LRU, Optimal).',
          '6. Simulation of Free Space Management techniques.',
          '7. Simulation of Disk Scheduling algorithms (FCFS, SSTF, SCAN, C-SCAN, LOOK).',
        ],
        textbooks: ['Andrew S. Tanenbaum and Herbert Bos, "Modern Operating Systems", PHI / Pearson.'],
        references: [
          'William Stallings, "Operating Systems: Internals and Design Principles", Pearson Education.',
          'Abraham Silberschatz, Peter B. Galvin, and Greg Gagne, "Operating System Concepts", John Wiley & Sons.',
          'Maurice J. Bach, "The Design of the UNIX Operating System", Prentice Hall.',
          'Charles Crowley, "Operating Systems: A Design-Oriented Approach", Tata McGraw-Hill.',
        ],
      },
      {
        code: 'CIT222',
        title: 'Management Information System',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH + PR',
        totalHours: '45 hrs',
        year: 'Year 2',
        semester: 'IV',
        objectives: [
          'Provide comprehensive understanding of information systems in business and management, enterprise applications (ERP, CRM, SCM), decision support systems, e-commerce, and ethical/security challenges.',
        ],
        outcomes: [
          'Explain the strategic role of information systems (TPS, MIS, DSS, ESS) in organizations.',
          'Understand enterprise systems (CRM, ERP, SCM), data warehousing, OLAP, and business system development lifecycles.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Foundations of Information Systems in Business',
            hours: '6 hrs',
            topics: [
              'Data, Information, Information System (IS), Resources and Characteristics of IS, Roles and Risks of IS in business',
              'Types of IS: TPS, MIS, DSS, ESS; Objectives, Characteristics, and Applications of MIS',
            ],
          },
          {
            unitNumber: 2,
            title: 'Competing with Information Technology',
            hours: '5 hrs',
            topics: [
              "Porter's Competitive Forces and Strategies, Value Chain and Strategic IS",
              'Business Process Reengineering (BPR), Agile Company, Virtual Company, Knowledge-Creating Company',
            ],
          },
          {
            unitNumber: 3,
            title: 'Data Resource Management',
            hours: '5 hrs',
            topics: [
              'Fundamental Data Concepts, Database Structures, Types of Databases (Operational, Distributed, External, Hypermedia), Data Warehouses and Data Mining',
            ],
          },
          {
            unitNumber: 4,
            title: 'Decision Support System',
            hours: '5 hrs',
            topics: [
              'Decision support in business, DSS concepts and components, Online Analytical Processing (OLAP), Using Decision Support Systems',
            ],
          },
          {
            unitNumber: 5,
            title: 'Enterprise Business System',
            hours: '5 hrs',
            topics: [
              'Cross-functional enterprise applications and Enterprise Application Integration (EAI)',
              'Customer Relationship Management (CRM): Phases, Benefits, Challenges, Trends',
              'Enterprise Resource Planning (ERP): Benefits, Challenges, Trends',
              'Supply Chain Management (SCM): Roles, Benefits, Challenges, Trends',
            ],
          },
          {
            unitNumber: 6,
            title: 'Developing Business Systems',
            hours: '7 hrs',
            topics: [
              'SDLC: Investigation, Analysis, Design, Development, Testing, Implementation, Maintenance',
              'Feasibility Studies, System Conversion Strategies, Prototyping, End-User Development, Outsourcing, RAD, Agile, XP, Scrum',
            ],
          },
          {
            unitNumber: 7,
            title: 'Electronic Commerce Systems',
            hours: '5 hrs',
            topics: [
              'Introduction to E-Commerce, E-Commerce vs. E-Business, Benefits and Limitations, Essential E-Commerce Processes, Electronic Payment Systems',
            ],
          },
          {
            unitNumber: 8,
            title: 'Security and Ethical Challenges',
            hours: '7 hrs',
            topics: [
              'IT Security Challenges: Hacking, Cyber theft, DoS attacks, Software piracy, Intellectual property theft, Malware, Privacy and Health issues',
              'Security management tools, Ethical and social dimensions of the Information Age',
            ],
          },
        ],
        laboratoryWork: [
          '1. Database Design & Implementation: Build a business database in MySQL/Oracle/MS Access and generate analytical reports.',
          '2. Data Visualization & Reporting: Build interactive executive dashboards using Tableau or Power BI.',
          '3. Systems Analysis & Design: Conduct a feasibility study and create Use Cases, Activity Diagrams, and ERDs.',
          '4. E-Commerce Prototype: Design an e-commerce prototype in Figma/Adobe XD with payment workflow.',
          '5. ERP Simulation: Simulate business process mapping in Odoo, SAP, or Oracle ERP.',
          '6. Cybersecurity & Risk Assessment: Conduct a system vulnerability assessment and mitigation plan.',
          '7. Decision Support System: Build a scenario-based DSS model in Excel or DSS software.',
          '8. Business Process Improvement: Model and optimize a business workflow using BPMN.',
        ],
        textbooks: [
          "James A. O'Brien and George M. Marakas, \"Management Information Systems\", McGraw-Hill.",
          'Kenneth C. Laudon and Jane P. Laudon, "Management Information Systems: Managing the Digital Firm", Pearson Education.',
        ],
        references: [
          'W.S. Jawadekar, "Management Information Systems", McGraw-Hill.',
          'Gordon B. Davis and Margrethe H. Olson, "Management Information Systems: Conceptual Foundations, Structure, and Development", Tata McGraw-Hill.',
        ],
      },
      {
        code: 'CIT223',
        title: 'Data Communication and Computer Networks',
        credit: 4,
        creditDisplay: '4',
        nature: 'TH + PR',
        totalHours: '60 hrs',
        year: 'Year 2',
        semester: 'IV',
        objectives: [
          'Learn the fundamental principles of computer networking across the TCP/IP and OSI protocol layers using a bottom-up approach, and configure, program, and secure modern IPv4/IPv6 networks.',
        ],
        outcomes: [
          'Design IPv4 and IPv6 networks interconnecting switches, routers, VLANs, and WAN links.',
          'Configure routing protocols, QoS strategies, and network security mechanisms (Firewalls, ACLs, VPNs, IPSec, SSL).',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Introduction to Computer Network and Data Communication',
            hours: '3 hrs',
            topics: [
              '1.1 Internet and Intranet',
              '1.2 History of Computer Networking and the Internet',
              '1.3 Packet-Switched Networks and Circuit-Switched Networks',
            ],
          },
          {
            unitNumber: 2,
            title: 'Physical Layer',
            hours: '7 hrs',
            topics: [
              '2.1 Analog and Digital Transmission',
              '2.2 Bandwidth Utilization: Multiplexing and Spectrum Spreading',
              '2.3 Guided and Unguided Transmission Media',
              '2.4 Switching techniques',
            ],
          },
          {
            unitNumber: 3,
            title: 'Data-Link Layer',
            hours: '10 hrs',
            topics: [
              '3.1 Introduction and Framing',
              '3.2 Error Detection and Correction',
              '3.3 Data Link Control (DLC) and Media Access Control (MAC)',
              '3.4 Wired and Wireless Networks: Coding Schemes, CDMA, 4G LTE, 5G Cellular Networks, Spread Spectrum Signals',
            ],
          },
          {
            unitNumber: 4,
            title: 'Network Layer',
            hours: '10 hrs',
            topics: [
              '4.1 Network Layer Protocols (IPv4, IPv6, Subnetting)',
              '4.2 Unicast and Multicast Routing Protocols & 4.3 Routing Algorithms',
              '4.4 Software-Defined Networking (SDN): Principles, Protocols, Implications',
              '4.5 Virtual LANs (VLANs), NAT, DHCP, ARP, BGP, OSPF',
              '4.6 NetFlow, 4.7 MPLS (Multi-Protocol Label Switching) and SD-WAN',
            ],
          },
          {
            unitNumber: 5,
            title: 'Transport Layer and Application Layer',
            hours: '6 hrs',
            topics: [
              '5.1 Transport Layer Protocols: TCP and UDP',
              '5.2 Standard Client-Server Application Protocols (HTTP, DNS, SMTP, FTP)',
              '5.3 Network Management & Multimedia Networking',
            ],
          },
          {
            unitNumber: 6,
            title: 'Network Essentials',
            hours: '6 hrs',
            topics: [
              '6.1 Quality of Service (QoS)',
              '6.2 Information Theory',
              '6.3 Network Management Framework: SNMP, NETCONF/YANG, ICMP, BGP, OSPF',
            ],
          },
          {
            unitNumber: 7,
            title: 'Networking as a Career',
            hours: '6 hrs',
            topics: [
              '7.1 Cisco Certifications on Network Design',
              '7.2 IoT Networking and VoIP',
              '7.3 SCADA and Real-Time Systems',
            ],
          },
          {
            unitNumber: 8,
            title: 'Network Security',
            hours: '9 hrs',
            topics: [
              '8.1 Introduction to Network Security',
              '8.2 Principles of Cryptography: Symmetric Key, Public Key Encryption, Cryptographic Hash Functions, MAC, Digital Signatures',
              '8.3 Securing Applications: Endpoint Authentication, Secure Email, SSL/TLS, IPSec and VPNs, Securing Wireless LANs, Firewalls and Intrusion Detection Systems (IDS)',
            ],
          },
          {
            unitNumber: 9,
            title: 'Network Defense & Deception Architectures',
            hours: '3 hrs',
            topics: ['9.1 DMZ (Demilitarized Zone), Honeypots, Honeynets, and Proxy Servers'],
          },
        ],
        laboratoryWork: [
          '1. Network cabling: Crimping straight-through and crossover UTP cables.',
          '2. Study of Network Devices (Repeater, Hub, Switch, Bridge, Router, Gateway).',
          '3. LAN setup, basic network commands, and initial Switch & Router configurations.',
          '4. Configuring and troubleshooting switched networks, VLANs, and WAN connections.',
          '5. Interpreting Ping and Traceroute outputs and demonstrating Distribution Layer functions.',
          '6. Implementing IPv4/IPv6 addressing schemes, Access Control Lists (ACLs), and Network Firewalls.',
          '7. Configuring DHCP, VLANs, IoT, and SIP/VoIP devices.',
          'Programming Assignments: (1) Network Socket Programming, (2) Deep Packet Inspection, (3) Network Log File Analysis.',
        ],
        textbooks: [
          'James F. Kurose and Keith W. Ross, "Computer Networking: A Top-Down Approach", 8th Edition, Pearson.',
          'Behrouz A. Forouzan, "Data Communications and Networking", McGraw-Hill.',
          'Jeffrey S. Beasley and Piyasat Nilkaew, "Networking Essentials", Pearson.',
        ],
        references: [
          'Behrouz A. Forouzan, "TCP/IP Protocol Suite", McGraw-Hill.',
          'William Stallings, "Cryptography and Network Security", Pearson.',
          'Andrew S. Tanenbaum, Nick Feamster, and David J. Wetherall, "Computer Networks", Pearson.',
        ],
      },
      {
        code: 'BSM221',
        title: 'Fundamentals of Probability and Statistics',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH + PR',
        totalHours: '45 hrs',
        year: 'Year 2',
        semester: 'IV',
        objectives: [
          'Develop statistical skills for solving IT-related problems using descriptive statistics, exploratory data analysis, probability distributions, sampling, parameter estimation, hypothesis testing, and correlation/regression.',
        ],
        outcomes: [
          'Organize and visualize raw datasets using frequency distributions, Box-and-Whisker plots, and charts.',
          'Compute measures of central tendency, dispersion, probability distributions (Binomial, Poisson, Normal), confidence intervals, Z/t hypothesis tests, and linear regression models.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Presentation of Data',
            hours: '4 hrs',
            topics: [
              'Definition of Statistics and its use in IT; Data management; Levels of measurement; Frequency distributions; Diagrammatic and graphical presentation; Graphical location of mode and median',
            ],
          },
          {
            unitNumber: 2,
            title: 'Measures of Location and Dispersion',
            hours: '10 hrs',
            topics: [
              'Measures of central tendency (Mean, Median, Mode) and Partition values (Quartiles, Deciles, Percentiles)',
              'Measures of dispersion (Range, Quartile Deviation, Mean Deviation, Standard Deviation, Coefficient of Variation)',
              'Measure of symmetry and normality; Exploratory Data Analysis (EDA): Stem-and-Leaf, Box-and-Whisker plot, Outlier detection',
            ],
          },
          {
            unitNumber: 3,
            title: 'Probability and Probability Distribution',
            hours: '10 hrs',
            topics: [
              "Basic terminologies, Additive and Multiplicative laws, Conditional probability, Bayes' Theorem, Mathematical expectation",
              'Discrete distributions (Binomial and Poisson distributions and fittings)',
              'Continuous distribution (Normal distribution, assumptions, and applications)',
            ],
          },
          {
            unitNumber: 4,
            title: 'Sampling and Distribution of Sampling Statistics',
            hours: '3 hrs',
            topics: [
              'Population and sample, Parameter and statistic, Probability and non-probability sampling methods',
              'Sampling and non-sampling errors, Central Limit Theorem, Sampling distributions of mean and proportion',
            ],
          },
          {
            unitNumber: 5,
            title: 'Parameter Estimation',
            hours: '3 hrs',
            topics: [
              'Characteristics of a good estimator, Point and interval estimation',
              'Confidence intervals for mean and proportion, Level of significance, Margin of error, Sample size determination',
            ],
          },
          {
            unitNumber: 6,
            title: 'Hypothesis Testing',
            hours: '6 hrs',
            topics: [
              'Null and alternative hypotheses, Type I and Type II errors, One-tailed and two-tailed tests, Critical values, Z-test and t-test for mean and proportion',
            ],
          },
          {
            unitNumber: 7,
            title: 'Simple Linear Correlation and Regression',
            hours: '9 hrs',
            topics: [
              "Scatter plots, Pearson's correlation coefficient, Spearman's rank correlation, Coefficient of determination, Probable error significance test",
              'Simple linear regression model using Least Squares method and interpretation of regression coefficients',
            ],
          },
        ],
        laboratoryWork: [
          '1. Data presentation (tables, diagrams, and graphs).',
          '2. Computation of central tendency and partition values (grouped and ungrouped data).',
          '3. Computation of dispersion measures.',
          '4. Computation of skewness, kurtosis, and Box-and-Whisker plots.',
          '5. Computation of correlation coefficients and fitting linear regression lines.',
          '6. Random number generation, sampling distributions, and sample size calculation.',
          '7. Fitting Binomial, Poisson, and Normal distributions to real datasets.',
          '8. Confidence interval estimation and Z-test / t-test hypothesis testing using statistical software / MS Excel / R / Python.',
        ],
        textbooks: [
          'Sheldon M. Ross, "Introduction to Probability and Statistics for Engineers and Scientists", Academic Press.',
          'David M. Levine et al., "Statistics for Managers Using Microsoft Excel", Pearson.',
        ],
      },
      {
        code: 'CIT224',
        title: 'Computer Graphics Technology',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH + PR',
        totalHours: '45 hrs',
        year: 'Year 2',
        semester: 'IV',
        objectives: [
          'Understand the theoretical foundations and practical implementation of 2D and 3D computer graphics algorithms, geometric transformations, viewing pipelines, illumination/shading models, and virtual reality.',
        ],
        outcomes: [
          'Implement scan-conversion algorithms (DDA, Bresenham, Midpoint Circle, Area Fill).',
          'Apply 2D and 3D homogeneous geometric transformations, clipping, projections, hidden-surface removal, and shading models.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Introduction of Computer Graphics',
            hours: '6 hrs',
            topics: [
              '1.1 Overview of Computer Graphics and Areas of Application',
              '1.2 Graphics Hardware: Display Technology, Raster Scan and Vector Displays, Input/Output Devices',
              '1.3 Graphics Software Standards, Machine-independent graphics languages, Introduction to OpenGL',
              '1.4 Color Models: RGB and HSV',
            ],
          },
          {
            unitNumber: 2,
            title: 'Scan Conversion Algorithms',
            hours: '9 hrs',
            topics: [
              "2.1 Line Drawing Algorithms: DDA and Bresenham's Algorithm (with derivations for positive and negative slopes)",
              '2.2 Circle Generation Algorithm: Midpoint Circle Algorithm with derivation',
              '2.3 Area Filling: Scan-Line Polygon Fill, Boundary Fill, and Flood Fill Techniques',
            ],
          },
          {
            unitNumber: 3,
            title: 'Two-Dimensional Geometric Transformations and Viewing',
            hours: '9 hrs',
            topics: [
              '3.1 Basic 2D Transformations: Translation, Rotation, Scaling',
              '3.2 Reflection and Shearing, 3.3 Homogeneous Coordinate Systems, 3.4 Composite Transformations',
              '3.5 2D Viewing Pipeline, Window-to-Viewport Coordinate Transformation',
              '3.6 Clipping: Cohen-Sutherland Line Clipping and Sutherland-Hodgman Polygon Clipping',
            ],
          },
          {
            unitNumber: 4,
            title: 'Three-Dimensional Graphics',
            hours: '8 hrs',
            topics: [
              '4.1 3D Object Representation: Polygon surfaces, Polygon tables, Plane equations, Polygon meshes',
              '4.2 Projections: Parallel Projections (Isometric and Oblique) and Perspective Projection',
              '4.3 3D Transformations: Translation, Rotation, Scaling, Reflection, Shear',
            ],
          },
          {
            unitNumber: 5,
            title: 'Visible Surface Detection',
            hours: '5 hrs',
            topics: [
              "5.1 Hidden Surface Removal Techniques: Back-Face Detection, Depth-Buffer (Z-Buffer) Method, A-Buffer Method, Scan-Line Method, Depth-Sorting (Painter's Algorithm)",
            ],
          },
          {
            unitNumber: 6,
            title: 'Illumination and Shading',
            hours: '5 hrs',
            topics: [
              '6.1 Illumination Theory, 6.2 Ambient Light, 6.3 Diffuse and Specular Reflections',
              '6.4 Polygon Surface Shading: Constant Shading, Gouraud Shading, Phong Shading',
            ],
          },
          {
            unitNumber: 7,
            title: 'Introduction to Virtual Reality',
            hours: '3 hrs',
            topics: [
              '7.1 Concept of Virtual Reality (VR), 7.2 Components of a VR System, 7.3 Types of VR Systems, 7.4 Applications of VR',
            ],
          },
        ],
        laboratoryWork: [
          'Implementation of 2D and 3D graphics algorithms (DDA, Bresenham Line, Midpoint Circle, Boundary/Flood Fill, 2D/3D Transformations, Cohen-Sutherland Clipping, OpenGL rendering) using C/C++/Java/OpenGL.',
        ],
        textbooks: ['Donald Hearn and M. Pauline Baker, "Computer Graphics", Prentice-Hall.'],
        references: [
          'James D. Foley, Andries van Dam, Steven K. Feiner, and John F. Hughes, "Computer Graphics: Principles and Practice in C", Addison-Wesley.',
          'R.K. Maurya, "Computer Graphics with Virtual Reality", Wiley India.',
          'F.S. Hill and Stephen M. Kelley, "Computer Graphics Using OpenGL", Prentice Hall.',
          'Peter Shirley, Michael Ashikhmin, and Steve Marschner, "Fundamentals of Computer Graphics", 3rd Edition, CRC Press.',
          'Mason Woo et al., "OpenGL Programming Guide", Pearson Education Asia.',
        ],
      },
      {
        code: 'CIT225',
        title: 'Project II',
        credit: 2,
        creditDisplay: '2',
        nature: 'PR',
        year: 'Year 2',
        semester: 'IV',
        prerequisites: [
          'Computer Programming I (CIT111)',
          'Web Technology I & II (CIT123, CIT211)',
          'Computer Programming II - Java (CIT122)',
          'Database Management System (CIT213)',
          'Data Communication and Computer Networks (CIT223)',
          'Computer Graphics Technology (CIT224)',
        ],
        objectives: [
          'Synthesize knowledge of computer-based subjects studied in the first and second years.',
          'Plan, design, develop, and implement a complete software/IT project in a collaborative team environment.',
          'Produce formal project documentation and defend the product before internal and external examiners.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Phase I: Team Formation & Conceptual Proposal',
            topics: [
              'Form a team of 2–3 members, define a conceptual framework in Computer Science/IT/ICT/Software, and defend the formal proposal.',
            ],
          },
          {
            unitNumber: 2,
            title: 'Phase II: System/Architectural Design & Progress Evaluation',
            topics: [
              'Complete overall system/architectural design and validation scheme; present the Progress Report before the internal evaluation committee.',
            ],
          },
          {
            unitNumber: 3,
            title: 'Phase III: Product Completion, Final Report & External Defense',
            topics: [
              'Demonstrate the completed software product, submit the final technical report, and pass the oral defense in the presence of an external examiner.',
            ],
          },
        ],
        projectGuidelines: {
          phases: [
            {
              title: 'First Phase (Proposal)',
              description:
                'Teams of 2–3 students develop a conceptual framework documented as a formal department proposal and present it to the examiner.',
            },
            {
              title: 'Second Phase (Design & Progress)',
              description:
                'Students complete the architectural design and validation scheme and present a Progress Report to the internal evaluator committee.',
            },
            {
              title: 'Third Phase (Final Output & Defense)',
              description:
                'Students deliver the working software output, submit the final report, and defend orally before an external examiner.',
            },
          ],
          documentItems: [
            'Project Team members (minimum 2 and maximum 3)',
            'Project supervisor(s)',
            'Technical description of the project',
            'Project Analysis, Design, Coding, Testing, and Implementation details',
          ],
        },
      },
    ],
  },
];
