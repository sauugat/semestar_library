import { SyllabusSemester } from './syllabusTypes';

export const SEMESTERS_PART_3: SyllabusSemester[] = [
  {
    id: 'sem-5',
    semesterNumber: 5,
    semesterRoman: 'V',
    year: 'Year 3',
    yearNumber: 3,
    title: 'Year 3 · Semester V',
    shortTitle: 'Semester V',
    totalCredits: 16,
    totalCourses: 6,
    description: 'Android & iOS mobile app development, micro/macroeconomics, object-oriented analysis & design with UML, numerical computing methods, research methodology, and technical proposal writing.',
    courses: [
      {
        code: 'CIT311',
        title: 'Mobile Application Development',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH + PR',
        totalHours: '45 hrs',
        year: 'Year 3',
        semester: 'V',
        objectives: [
          'Introduce mobile application development platforms, architecture (MVC), UI design, local storage, REST APIs, testing, debugging, and app store deployment for Android and iOS.',
        ],
        outcomes: [
          'Develop Android (Java/XML, Android Studio) and iOS (Swift, Xcode) applications.',
          'Implement MVC architecture, SQLite/Realm local persistence, Firebase/Push notifications, Retrofit/Volley API integration, and APK/App Store deployment.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Introduction to Mobile Application Development',
            hours: '2 hrs',
            topics: [
              '1.1 Overview and History of Mobile Application Development',
              '1.2 Mobile application development vs. Web application development',
              '1.3 Types of Mobile Applications (Native, Hybrid, Web)',
            ],
          },
          {
            unitNumber: 2,
            title: 'Overview of Mobile Platforms',
            hours: '4 hrs',
            topics: [
              '2.1 Mobile Application Platforms (iOS, Android, Cross-Platform)',
              '2.2 Choosing the right platform & 2.3 Understanding the development environment',
              '2.4 Mobile application development lifecycle',
            ],
          },
          {
            unitNumber: 3,
            title: 'Mobile Application Architecture & Security',
            hours: '12 hrs',
            topics: [
              '3.1 Basic architecture of mobile applications',
              '3.2 Model-View-Controller (MVC) architecture pattern',
              '3.3 Data storage options in mobile applications',
              '3.4 Application Programming Interfaces (APIs) and integration',
              '3.5 Data privacy and security in mobile applications',
            ],
          },
          {
            unitNumber: 4,
            title: 'Introduction to Android Development',
            hours: '12 hrs',
            topics: [
              '4.1 Android Studio, Android SDK, and AVD Emulator',
              '4.2 Basic Android application development using Java and XML',
              '4.3 Android UI components and layouts (Linear, Relative, Toolbar, ListView, RecyclerView, GridView, ScrollView, ViewPager, TabLayout)',
              '4.4 Working with device sensors',
              '4.5 Local Storage: Shared Preferences, SQLite, Realm',
              '4.6 Firebase and Push Notifications',
            ],
          },
          {
            unitNumber: 5,
            title: 'Testing and Debugging Mobile Applications',
            hours: '8 hrs',
            topics: [
              '5.1 Techniques and tools for testing and debugging mobile applications',
              '5.2 Unit testing in mobile application development',
              '5.3 Alpha testing and Beta testing in mobile applications',
            ],
          },
          {
            unitNumber: 6,
            title: 'Deployment of Mobile Applications',
            hours: '5 hrs',
            topics: [
              '6.1 Bundling mobile applications (APK / AAB / IPA)',
              '6.2 Signing mobile applications',
              '6.3 App Store & Google Play guidelines, policies, and deployment process',
            ],
          },
          {
            unitNumber: 7,
            title: 'Introduction to iOS Development',
            hours: '2 hrs',
            topics: [
              '7.1 Introduction to Xcode, Swift, and iOS Simulator',
              '7.2 Basic iOS application development using Swift',
              '7.3 Xcode IDE features & 7.4 iOS Native UI elements',
            ],
          },
        ],
        laboratoryWork: [
          '1. Create a simple Android app displaying "Hello World" using a TextView.',
          '2. Bundle an Android app to APK and install via AVD Emulator or USB debugging.',
          '3. Create a LinearLayout with two TextViews and a Button displaying current date and time on click.',
          '4. Implement a ListView/RecyclerView displaying items with images and text.',
          '5. Implement a form with text input fields, validation, and a submit button.',
          '6. Implement dialogs, toasts, and a pop-up window triggered by a button click.',
          '7. Implement an Options Menu and Context Menu displaying Toast messages.',
          '8. Navigate between Activities and Fragments using explicit and implicit Intents.',
          '9. Implement a SQLite database with CRUD operations and display records in a ListView.',
          '10. Fetch remote JSON data using Retrofit/Volley and render it in a list.',
          '11. Use background threading to display a delayed notification/message.',
          '12. Integrate Google Maps API and GPS location markers.',
          '13. Implement a Toolbar with a SearchView filter and a multi-tab TabLayout.',
        ],
        textbooks: [
          'Bill Phillips and Brian Hardy, "Android Programming: The Big Nerd Ranch Guide".',
          'Christian Keur and Aaron Hillegass, "iOS Programming: The Big Nerd Ranch Guide".',
          'Neil Smyth, "Android Studio Development Essentials".',
          'Bart Jacobs, "Beginning iOS 12 Programming with Swift".',
        ],
        references: [
          'F. Ahmed and M.E. Hoque, "An Overview of Mobile Application Development: Challenges, Opportunities, and Future Trends", IEEE Access, 2018.',
          'Google Android Developer Documentation (https://developer.android.com/docs).',
          'Apple iOS Developer Documentation (https://developer.apple.com/documentation/).',
        ],
      },
      {
        code: 'BCT311',
        title: 'Economics',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH',
        totalHours: '45 hrs',
        year: 'Year 3',
        semester: 'V',
        objectives: [
          'Enhance understanding of microeconomic and macroeconomic theories and their practical application to decision-making in management, IT, and business with reference to Nepal.',
        ],
        outcomes: [
          'Analyze demand, supply, elasticities, consumer utility behavior, cost/revenue curves, and market structures.',
          'Evaluate national income accounting (GDP, GNP, NI), money, inflation, banking (Nepal Rastra Bank), and international trade (BOP/BOT).',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Introduction',
            hours: '3 hrs',
            topics: [
              '1.1 Definitions and ten basic principles of economics',
              '1.2 Microeconomics vs. Macroeconomics: distinction and mutual interdependence',
            ],
          },
          {
            unitNumber: 2,
            title: 'Demand, Supply and Elasticities',
            hours: '8 hrs',
            topics: [
              '2.1 Demand concept, schedule, curve, function, types, and Law of Demand',
              '2.2 Supply concept, schedule, curve, function, types, and Law of Supply',
              '2.3 Measurement of Price, Income, and Cross Elasticity of Demand',
              '2.4 Measurement of Elasticity of Supply',
            ],
          },
          {
            unitNumber: 3,
            title: 'Theory of Consumer Behavior',
            hours: '9 hrs',
            topics: [
              '3.1 Concept of utility and types of utility analysis',
              '3.2 Cardinal utility analysis: assumptions, consumer equilibrium, and criticisms',
              '3.3 Ordinal utility analysis: Indifference curve, Marginal Rate of Substitution (MRS), Budget line, Consumer equilibrium, Price effect (PCC), Income effect (ICC), Substitution effect (Hicksian approach)',
            ],
          },
          {
            unitNumber: 4,
            title: 'Cost and Revenue Curves',
            hours: '7 hrs',
            topics: [
              '4.1 Opportunity, implicit, explicit, accounting, economic, fixed, and variable costs',
              '4.2 Short-run and long-run cost curves (Total, Average, Marginal) and AC–MC relationships',
              '4.3 Total, Average, and Marginal Revenue curves under perfect and imperfect competition; Numerical exercises',
            ],
          },
          {
            unitNumber: 5,
            title: 'Market Structure',
            hours: '7 hrs',
            topics: [
              '5.1 Perfect Competition: characteristics, short-run and long-run equilibrium of firm and industry, supply curve derivation',
              '5.2 Monopoly: characteristics, short-run and long-run equilibrium, price discrimination and its degrees',
              '5.3 Monopolistic Competition & 5.4 Oligopoly; 5.5 Numerical exercises',
            ],
          },
          {
            unitNumber: 6,
            title: 'National Income Accounting',
            hours: '3 hrs',
            topics: [
              '6.1 Concepts of National Income: GDP, NDP, GNP, NNP, NI, Personal Income (PI), Disposable Income (DI), Per Capita Income (PCI), Real vs. Nominal GDP, GDP Deflator',
            ],
          },
          {
            unitNumber: 7,
            title: 'Forms of Business Organization',
            hours: '2 hrs',
            topics: [
              '7.1 Sole Proprietorship, Partnership, Joint Stock Companies, State-Owned Enterprises, Multinational Companies',
            ],
          },
          {
            unitNumber: 8,
            title: 'Money, Inflation, Banking, and International Trade',
            hours: '6 hrs',
            topics: [
              '8.1 Functions and value of money, Money supply (M1, M2)',
              '8.2 Inflation: types, causes, and effects',
              '8.3 Commercial banks vs. Central bank functions with reference to Nepal Rastra Bank (NRB)',
              '8.4 International Trade: importance, Balance of Payment (BOP), and Balance of Trade (BOT)',
            ],
          },
        ],
        laboratoryWork: [
          'Practical numerical exercises computed using Microsoft Excel and relevant statistical tools.',
        ],
        textbooks: [
          'Dominick Salvatore, "International Economics", 8th Edition, Wiley India.',
          'D.N. Dwivedi, "Macroeconomic Theory and Policy", Tata McGraw-Hill.',
          'A. Koutsoyiannis, "Modern Microeconomics", ELBS.',
          'N. Gregory Mankiw, "Principles of Microeconomics", Latest Edition.',
          'Edward Shapiro, "Macroeconomic Analysis", Galgotia Publications.',
        ],
      },
      {
        code: 'CIT312',
        title: 'Object Oriented Analysis and Design using UML',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH + PR',
        totalHours: '45 hrs',
        year: 'Year 3',
        semester: 'V',
        objectives: [
          'Study object-oriented software development processes (Unified Process), master visual modeling with Unified Modeling Language (UML), apply GRASP and GoF design patterns, and map object designs to code.',
        ],
        outcomes: [
          'Create Use Case models, System Sequence Diagrams, Domain/Conceptual Models, Collaboration/Communication Diagrams, and Design Class Diagrams.',
          'Apply GRASP principles (Information Expert, Creator, Low Coupling, High Cohesion, Controller) and translate UML models into object-oriented code.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Object Oriented Fundamentals',
            hours: '10 hrs',
            topics: [
              '1.1 Introduction & 1.2 Object-Oriented Analysis and Design (OOAD)',
              '1.3 Iterative development and the Unified Process (UP)',
              '1.4 Case Study & 1.5 Understanding Requirements',
              '1.6 Use Case modeling: include, extend, and generalization relationships',
              '1.7 Overview of Unified Modeling Language (UML): Fundamentals and Notations',
            ],
          },
          {
            unitNumber: 2,
            title: 'Object Oriented Analysis',
            hours: '10 hrs',
            topics: [
              '2.1 Representation of System Behavior: System Sequence Diagrams (SSD) and Use Cases',
              '2.2 Building a Conceptual / Domain Model: Identifying domain objects, adding associations, and adding attributes',
            ],
          },
          {
            unitNumber: 3,
            title: 'Object Oriented Design',
            hours: '13 hrs',
            topics: [
              '3.1 Writing operation contracts: Describing and elaborating Use Cases',
              '3.2 Interaction Diagrams: Collaboration/Communication Diagrams and Sequence Diagrams',
              '3.3 Objects and GRASP Patterns (Information Expert, Creator, Low Coupling, High Cohesion, Controller)',
              '3.4 Determining Visibility & 3.5 Design Class Diagrams',
            ],
          },
          {
            unitNumber: 4,
            title: 'Implementation',
            hours: '12 hrs',
            topics: [
              '4.1 Programming and Development Process',
              '4.2 Mapping Design to Code',
              '4.3 Creating Class Definitions from Design Class Diagrams',
              '4.4 Creating Methods from Collaboration/Sequence Diagrams',
              '4.5 Updating Class Definitions, 4.6 Classes in Code, 4.7 Exception and Error Handling',
            ],
          },
        ],
        laboratoryWork: [
          'Object-oriented analysis, design, and pattern modeling exercises in a CASE/UML environment, translating full Use Case, Sequence, and Class Diagrams into working code.',
        ],
        textbooks: ['Craig Larman, "Applying UML and Patterns", Pearson Education Asia, 2008.'],
        references: [
          'Martin Fowler, "UML Distilled: A Brief Guide to the Standard Object Modeling Language", Addison-Wesley.',
          'Grady Booch, Ivar Jacobson, and James Rumbaugh, "The Unified Software Development Process", Addison-Wesley, 2009.',
          'Ivar Jacobson, "Object-Oriented Software Engineering: A Use Case Driven Approach", Addison-Wesley, 2009.',
        ],
      },
      {
        code: 'BSM311',
        title: 'Numerical Methods',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH + PR',
        totalHours: '45 hrs',
        year: 'Year 3',
        semester: 'V',
        objectives: [
          'Develop numerical computing techniques and algorithms for solving non-linear equations, linear systems, interpolation, numerical differentiation/integration, and ordinary/partial differential equations with error analysis.',
        ],
        outcomes: [
          'Select appropriate numerical methods, analyze convergence and approximation errors, and implement numerical algorithms in C, Python, MATLAB, or Octave.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Concepts of Numerical Computing, Approximations and Errors',
            hours: '4 hrs',
            topics: [
              '1.1 Introduction, Process, and Characteristics of Numerical Computing',
              '1.2 Computer Codes and Floating-Point Arithmetic: Representation of Numbers',
              '1.3 Significant Digits, Inherent, Numerical, Modeling, Absolute, and Relative Errors',
              '1.4 Stability, Convergence of Iterative Processes, Error Estimation',
            ],
          },
          {
            unitNumber: 2,
            title: 'Numerical Method for Solving Nonlinear Equations',
            hours: '7 hrs',
            topics: [
              '2.1 Review of Algebraic, Polynomial, and Transcendental Equations',
              '2.2 Iterative Methods, Starting and Stopping Criteria',
              '2.3 Bisection Method and Rate of Convergence',
              '2.4 Newton-Raphson Method and Rate of Convergence',
              '2.5 Fixed-Point Iteration Method and Rate of Convergence',
              '2.6 Systems of Nonlinear Equations: Fixed-Point and Newton-Raphson methods',
            ],
          },
          {
            unitNumber: 3,
            title: 'Solution of System of Linear Equations',
            hours: '8 hrs',
            topics: [
              '3.1 Existence of Solutions',
              '3.2 Direct Solution by Gaussian Elimination Method',
              '3.3 Direct Solution by Gauss-Jordan Method',
              '3.4 Jacobi Iteration Method & 3.5 Gauss-Seidel Iteration Method',
              '3.6 Convergence of Iterative Methods',
            ],
          },
          {
            unitNumber: 4,
            title: 'Curve Fitting: Interpolation and Regression',
            hours: '8 hrs',
            topics: [
              '4.1 Lagrange Interpolation Polynomial',
              '4.2 Newton Divided Difference Interpolation Polynomial',
              '4.3 Interpolation with Equidistant Points (Forward/Backward Differences)',
              '4.4 Chebyshev Interpolation Polynomial & 4.5 Error in Polynomial Interpolation',
              '4.6 Least Squares Linear Regression & 4.7 Fitting Transcendental Equations',
            ],
          },
          {
            unitNumber: 5,
            title: 'Numerical Differentiation and Integration',
            hours: '9 hrs',
            topics: [
              '5.1 Differentiating Continuous and Tabulated Functions (Forward, Backward, Central Differences) & Error Analysis',
              '5.2 Richardson Extrapolation',
              '5.3 Newton-Cotes Quadrature Formulas',
              "5.4 Trapezoidal Rule (Simple & Composite), Simpson's 1/3 Rule, Simpson's 3/8 Rule, Error Analysis",
              '5.5 Romberg Integration',
            ],
          },
          {
            unitNumber: 6,
            title: 'Numerical Solutions of Differential Equations',
            hours: '9 hrs',
            topics: [
              '6.1 Review of ODEs and Initial Value Problems',
              "6.2 Taylor Series Method and Euler's Method",
              '6.3 Runge-Kutta Methods (2nd Order and 4th Order)',
              "6.4 Partial Differential Equations: Parabolic (Heat Equation), Elliptic (Laplace's and Poisson's Equations), Hyperbolic (Wave Equation)",
            ],
          },
        ],
        laboratoryWork: [
          'Implement prescribed numerical algorithms (Bisection, Newton-Raphson, Gaussian Elimination, Gauss-Seidel, Lagrange/Newton Interpolation, Least Squares Regression, Trapezoidal/Simpson Integration, RK4 ODE solver, and PDE finite-difference solvers) in Python, C, MATLAB, or Octave.',
        ],
        textbooks: [
          'W. Cheney and D. Kincaid, "Numerical Mathematics and Computing", 7th Edition, Brooks/Cole Publishing, 2012.',
          'Cleve Moler, "Numerical Computing with MATLAB", SIAM, 2004.',
        ],
        references: [
          'W.Y. Yang, W. Cao, T.S. Chung, and J. Morris, "Applied Numerical Methods Using MATLAB", John Wiley & Sons, 2005.',
          'G.R. D.C. and T.B. Budhathoki, "A Textbook of Numerical Methods", Heritage Publishers & Distributors, 2078.',
        ],
      },
      {
        code: 'BCT312',
        title: 'Research Methodology',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH',
        totalHours: '45 hrs',
        year: 'Year 3',
        semester: 'V',
        objectives: [
          'Understand the principles of scientific and business/IT research, literature review, research design, measurement scaling, sampling, qualitative/quantitative data analysis, and research report writing.',
        ],
        outcomes: [
          'Formulate research problems, theoretical/conceptual frameworks, and testable hypotheses.',
          'Design valid and reliable questionnaires/instruments, select appropriate sampling and statistical methods, and author academic research proposals and reports.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Introduction to Research',
            hours: '7 hrs',
            topics: [
              '1.1 Concept, nature, and types of research',
              '1.2 Scientific research process and characteristics',
              '1.3 Research paradigms and contemporary approaches',
              '1.4 Management & IT research in decision-making',
              '1.5 Ethical issues in research & 1.6 Status of research in Nepal',
            ],
          },
          {
            unitNumber: 2,
            title: 'Literature Review',
            hours: '5 hrs',
            topics: [
              '2.1 Concept, importance, functions, and steps in literature review',
              '2.2 Searching and selecting scholarly literature',
              '2.3 Best practices in writing a literature review',
            ],
          },
          {
            unitNumber: 3,
            title: 'Research Problem, Research Question, Theoretical and Conceptual Framework',
            hours: '5 hrs',
            topics: [
              '3.1 Formulating research problems, research questions, and objectives',
              '3.2 Theoretical and Conceptual Frameworks; Deduction and Induction',
              '3.3 Hypothesis types, formulation, and criteria of a good hypothesis',
            ],
          },
          {
            unitNumber: 4,
            title: 'Research Design',
            hours: '5 hrs',
            topics: [
              '4.1 Concept, importance, and components of research design',
              '4.2 Exploratory, Descriptive, Case Study, Comparative, Experimental, and Cross-Sectional designs',
            ],
          },
          {
            unitNumber: 5,
            title: 'Measurement, Scaling and Sampling',
            hours: '9 hrs',
            topics: [
              '5.1 Measurement scales: Nominal, Ordinal, Interval, and Ratio',
              '5.2 Validity and Reliability of research instruments',
              '5.3 Scale construction and attitude measurement techniques',
              '5.4 Probability and Non-probability sampling methods',
              '5.5 Sampling and non-sampling errors and minimization strategies',
            ],
          },
          {
            unitNumber: 6,
            title: 'Data Collection and Analysis',
            hours: '9 hrs',
            topics: [
              '6.1 Primary and secondary data sources and collection methods',
              '6.2 Questionnaire design principles and components',
              '6.3 Qualitative data collection & 6.4 Data entry, editing, coding, and tabulation',
              '6.5 Descriptive statistics, correlation, and regression analysis',
              '6.6 Inferential statistics (Confidence intervals and Hypothesis testing) & 6.7 Qualitative data analysis',
            ],
          },
          {
            unitNumber: 7,
            title: 'Research Proposal and Scientific Writing',
            hours: '5 hrs',
            topics: [
              '7.1 Research topic selection, structure and components of a good research proposal',
              '7.2 Structure, layout, and methodology of writing a research report',
              '7.3 Academic citations and reference management',
            ],
          },
        ],
        textbooks: ['William G. Zikmund, "Business Research Methods", Thompson Publishing.'],
        references: [
          'Donald R. Cooper and Pamela S. Schindler, "Business Research Methods", Tata McGraw-Hill.',
          'Mark Saunders, Philip Lewis, and Adrian Thornhill, "Research Methods for Business Students", Pearson Education.',
          'Alan Bryman and Emma Bell, "Business Research Methods", Oxford University Press.',
          'Uma Sekaran, "Research Methods for Business: A Skill Building Approach", John Wiley & Sons.',
        ],
      },
      {
        code: 'BCT313',
        title: 'Technical Proposal Writing',
        credit: 1,
        creditDisplay: '1',
        nature: 'PR',
        totalHours: '15 hrs',
        year: 'Year 3',
        semester: 'V',
        objectives: [
          'Differentiate forms of technical proposals, structure formal proposals, grant applications, and contract documents, and cite sources accurately in APA, IEEE, and MLA formats.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Basic Concept of Technical Proposal',
            hours: '3 hrs',
            topics: [
              'Introduction to Proposals; Solicited vs. Unsolicited, Informal vs. Formal, Internal vs. External proposals; Persuasion in proposals (Logos, Ethos, Pathos)',
            ],
          },
          {
            unitNumber: 2,
            title: 'Structuring the Technical Proposal',
            hours: '3 hrs',
            topics: [
              'Components of a formal proposal: Title page, Executive summary, Problem statement, Rationale, Objectives, Literature review, Significance, Methodology, Limitations, Budget/Cost estimate, Time schedule, Feasibility, Expected outcomes, References; Common mistakes',
            ],
          },
          {
            unitNumber: 3,
            title: 'Grant Proposal and Contract Documents',
            hours: '3 hrs',
            topics: [
              'Grant writing steps: Planning, identifying grantmakers, drafting, revising, and submitting; Types of contract documents and preparing sample contracts',
            ],
          },
          {
            unitNumber: 4,
            title: 'Report Writing',
            hours: '3 hrs',
            topics: [
              'Classification of reports, Long and short report structures, Standard models of technical reports',
            ],
          },
          {
            unitNumber: 5,
            title: 'Research Project Work and Technical Writing',
            hours: '3 hrs',
            topics: [
              'Qualitative, quantitative, and integrative research approaches; In-text citations and referencing styles (APA, IEEE, MLA)',
            ],
          },
        ],
        references: [
          'Dharma Adhikari and Phanindra Upadhyaya (2013), "Technical Communication II", Kathmandu.',
          'Arjun Khanal (2010), "Communication Skills in English", Sukunda Pustak Bhandar, Kathmandu.',
          'R.C. Sharma et al. (2009), "Business Correspondence and Report Writing", Tata McGraw-Hill.',
        ],
      },
    ],
  },
  {
    id: 'sem-6',
    semesterNumber: 6,
    semesterRoman: 'VI',
    year: 'Year 3',
    yearNumber: 3,
    title: 'Year 3 · Semester VI',
    shortTitle: 'Semester VI',
    totalCredits: 18,
    totalCourses: 6,
    description: 'IT project management, human-computer interaction & UI/UX design, digital forensics & cybersecurity, artificial intelligence, financial accounting, and Project III.',
    courses: [
      {
        code: 'BCT321',
        title: 'IT Project Management',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH',
        totalHours: '45 hrs',
        year: 'Year 3',
        semester: 'VI',
        objectives: [
          'Provide comprehensive knowledge of IT project management principles, scope/time/cost/quality/risk/procurement management, WBS, CPM/PERT, and Earned Value Management (EVM).',
        ],
        outcomes: [
          'Plan, schedule, estimate, and manage software and IT projects using modern project management frameworks.',
          'Evaluate project risk, quality assurance, communication plans, and procurement contracts.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Introduction',
            hours: '8 hrs',
            topics: [
              'Basics of IT projects and IT project management, Classification of IT projects, Components of project management, Conventional vs. Modern IT project management, Scope, Project management cycle and framework',
            ],
          },
          {
            unitNumber: 2,
            title: 'Project Analysis and Time Management',
            hours: '7 hrs',
            topics: [
              'Project planning and scheduling, Activity resource and duration estimation, Work Breakdown Structure (WBS), Critical Path Method (CPM) and Program Evaluation and Review Technique (PERT), IT project lifecycle phases and organizational structures',
            ],
          },
          {
            unitNumber: 3,
            title: 'Project Cost Management Process',
            hours: '6 hrs',
            topics: [
              'Types of cost estimates, Cost budgeting, Cost control methods, Earned Value Management (EVM), and Project Portfolio Management',
            ],
          },
          {
            unitNumber: 4,
            title: 'Project Quality Management',
            hours: '4 hrs',
            topics: [
              'IT Project quality, Quality requirements, Quality management planning, Quality Assurance, and Quality Control tools',
            ],
          },
          {
            unitNumber: 5,
            title: 'Project Communication Management',
            hours: '4 hrs',
            topics: ['Communication planning requirements, procedures, effective team communication, and status reporting'],
          },
          {
            unitNumber: 6,
            title: 'Project Risk Management',
            hours: '5 hrs',
            topics: [
              'IT project risks (positive and negative), Risk management plan, Risk identification and analysis, Risk modeling, monitoring, and control',
            ],
          },
          {
            unitNumber: 7,
            title: 'Project Procurement Management',
            hours: '4 hrs',
            topics: [
              'IT procurement management, Planning for purchase and acquisition, Contract management, Evaluation criteria, and Procurement legalities',
            ],
          },
          {
            unitNumber: 8,
            title: 'Custom Process in IT Projects',
            hours: '5 hrs',
            topics: ['Creating custom IT project management methodologies, Certification process flow, and Code of Ethics'],
          },
          {
            unitNumber: 9,
            title: 'Case Study',
            hours: '2 hrs',
            topics: ['End-to-end case study covering effective IT project management practices'],
          },
        ],
        references: [
          'Kathy Schwalbe, "Information Technology Project Management", 7th Edition, Cengage Learning, 2013.',
          'M.C. Christensen and R.H. Thayer, "The Project Manager’s Guide to Software Engineering’s Best Practices", IEEE Computer Society, 2001.',
          'Clifford F. Gray and Erik W. Larson, "Project Management: The Managerial Process", McGraw-Hill.',
          'Walker Royce, "Software Project Management: A Unified Framework", Pearson.',
        ],
      },
      {
        code: 'CIT321',
        title: 'Human Computer Interface and UI Design',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH + PR',
        totalHours: '45 hrs',
        year: 'Year 3',
        semester: 'VI',
        objectives: [
          'Understand the principles and methods of Human-Computer Interaction (HCI) and User Interface (UI) Design, usability engineering, human cognitive/perceptual capabilities, wireframing/prototyping, and interface evaluation.',
        ],
        outcomes: [
          'Analyze user needs and human factors to design accessible, high-usability graphical and web interfaces.',
          'Build low-fidelity and high-fidelity UI prototypes and evaluate them using the DECIDE framework and heuristic/usability testing.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Introduction and Overview',
            hours: '3 hrs',
            topics: [
              '1.1 Defining the User Interface',
              '1.2 The Importance of Good Design',
              '1.3 History and evolution of Human-Computer Interaction (HCI)',
            ],
          },
          {
            unitNumber: 2,
            title: 'Characteristics of Graphical and Web User Interfaces',
            hours: '6 hrs',
            topics: [
              '2.1 Interaction styles & 2.2 The Graphical User Interface (GUI)',
              '2.3 Concept of Direct Manipulation',
              '2.4 Characteristics of Graphical Interfaces vs. 2.5 Web Interfaces',
              '2.6 Web page vs. Web application design & 2.7 General principles of UI design',
            ],
          },
          {
            unitNumber: 3,
            title: 'Usability Engineering',
            hours: '6 hrs',
            topics: [
              '3.1 Usability and its attributes (Learnability, Efficiency, Memorability, Errors, Satisfaction)',
              '3.2 Usability Trade-offs',
              '3.3 Categories of Users and Individual User Differences',
            ],
          },
          {
            unitNumber: 4,
            title: 'The Usability Engineering Lifecycle & User Profiling',
            hours: '4 hrs',
            topics: [
              '4.1 The Human Action Cycle (Execution and Evaluation gulfs)',
              '4.2 Human Characteristics in Design (Perception, Memory, Visual Acuity, Foveal/Peripheral Vision, Sensory Storage, Information Processing, Learning, Skill)',
              '4.3 Human Considerations in Design & 4.4 Performance vs. Preference',
            ],
          },
          {
            unitNumber: 5,
            title: 'Identifying Needs and Establishing Requirements',
            hours: '4 hrs',
            topics: [
              '5.1 Introduction to requirements & 5.2 Types of requirements',
              '5.3 Data Gathering Techniques & 5.4 Task Description and Task Analysis',
            ],
          },
          {
            unitNumber: 6,
            title: 'Prototyping and Construction',
            hours: '6 hrs',
            topics: [
              '6.1 What is a prototype and why prototype?',
              '6.2 Low-fidelity vs. High-fidelity prototyping, Compromises in prototyping, From design to implementation',
            ],
          },
          {
            unitNumber: 7,
            title: 'Conceptual and Physical Design',
            hours: '6 hrs',
            topics: [
              '7.1 Conceptual Design: Developing and expanding a conceptual model, using scenarios and prototypes',
              '7.2 Physical Design: Guidelines, widget selection, and 7.3 UI Tool Support',
            ],
          },
          {
            unitNumber: 8,
            title: 'User-Centered Approaches to Interaction Design',
            hours: '4 hrs',
            topics: [
              '8.1 Advantages of involving users in development & 8.2 Principles of User-Centered Design (UCD)',
              '8.3 Applying Ethnography in Design (Coherence, Contextual Design)',
              '8.4 Participatory Design (PICTIVE, CARD)',
            ],
          },
          {
            unitNumber: 9,
            title: 'Evaluation',
            hours: '6 hrs',
            topics: [
              '9.1 What, when, and why to evaluate',
              '9.2 Formative vs. Summative Evaluation',
              '9.3 Evaluation Paradigms and 9.4 Evaluation Techniques',
              '9.5 DECIDE Framework for planning usability evaluations',
            ],
          },
        ],
        laboratoryWork: [
          'Design, prototype (wireframes + interactive high-fidelity UI), and evaluate a real-world web or mobile application interface applying user-centered design principles.',
        ],
        textbooks: [
          'Wilbert O. Galitz, "The Essential Guide to User Interface Design", 3rd Edition, Wiley.',
          'Helen Sharp, Jennifer Preece, and Yvonne Rogers, "Interaction Design: Beyond Human-Computer Interaction", 5th Edition, Wiley.',
          'Jakob Nielsen, "Usability Engineering", Morgan Kaufmann.',
        ],
        references: [
          'Donald A. Norman, "The Design of Everyday Things".',
          'Alan Cooper, Robert Reimann, David Cronin, and Christopher Noessel, "About Face: The Essentials of Interaction Design", 4th Edition, Wiley.',
          'Ben Shneiderman, "Designing the User Interface", 4th Edition, Pearson.',
          'Gavriel Salvendy, "Handbook of Human Factors and Ergonomics", 4th Edition, Wiley.',
        ],
      },
      {
        code: 'CIT322',
        title: 'Digital Forensic Security Technologies',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH + PR',
        totalHours: '45 hrs',
        year: 'Year 3',
        semester: 'VI',
        objectives: [
          'Acquaint students with computer forensics fundamentals, privacy/security concepts, cybercrime investigation, OS/memory/file-system forensics, forensic tools, and Nepalese cyber laws.',
        ],
        outcomes: [
          'Contrast cybercrime with conventional crime and follow admissibility rules of digital evidence.',
          'Conduct network, email, Windows/Linux/Android file-system, and memory-level forensic investigations using industry tools.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Introduction and Basic Concepts',
            hours: '6 hrs',
            topics: [
              '1.1 Networking Refresher (OSI, TCP/IP, Subnetting); Encryption & Cryptography basics (E2EE, Hashing, CIA Triad, Steganography, Cryptocurrency)',
              '1.2 Data Backup & Storage Fundamentals: File Systems (FAT16, VFAT, FAT32, NTFS, EXT4), 3-2-1 Backup Rule, RAID, Disaster Recovery, High Availability',
              '1.3 Proprietary and Open-Source Systems & 1.4 Introduction to Digital Forensics',
            ],
          },
          {
            unitNumber: 2,
            title: 'Basic Security Concepts',
            hours: '8 hrs',
            topics: [
              '2.1 Information & Network Security, Firewalls, PAM, ACLs; Malware, Trojans, Adware, DoS/DDoS, Ransomware, Honeypots, Social Engineering; Security, Privacy, and Trust',
              '2.2 Introduction to Penetration Testing: Information Gathering, Vulnerability Analysis, Sniffing, Spoofing, Password Attacks, Reverse Engineering',
              '2.3 Threat, Vulnerability, and Risk & 2.4 Data Confidentiality',
            ],
          },
          {
            unitNumber: 3,
            title: 'Cybersecurity and Cybercrime',
            hours: '10 hrs',
            topics: [
              '3.1 Conventional Crime vs. Cybercrime',
              '3.2 Phishing, Spamming, Web/Email Spoofing, Cyberstalking, Commercial Espionage, Piracy, Financial Fraud, Identity Theft, and Prevention Measures',
              '3.3 Cybercrime Case Studies: ILOVEYOU (LOVE-LETTER-FOR-YOU.TXT.vbs), Stuxnet, WannaCry',
            ],
          },
          {
            unitNumber: 4,
            title: 'Computer Forensics Technology',
            hours: '10 hrs',
            topics: [
              '4.1 Forensic Tools: Kali Linux, Nmap, Wireshark, Metasploit, FTK Imager, Autopsy; Data Recovery Tools (PhotoRec, AccessData, The Sleuth Kit - TSK)',
              '4.2 Rules of Evidence (Admissible, Authentic, Complete, Reliable, Believable)',
              '4.3 Good Forensic Practices (Identification, Securing, Collecting, Packaging, Preserving, Chain of Custody Documentation); SSH/Telnet, Network Monitoring, IDS/IPS, Packet Sniffing',
            ],
          },
          {
            unitNumber: 5,
            title: 'Operating System Investigation',
            hours: '8 hrs',
            topics: [
              '5.1 Windows File Systems, Registry Hives, and Event Logs',
              '5.2 Linux File System basics',
              '5.3 Android File System basics',
              '5.4 Memory acquisition and forensic analysis in Windows',
            ],
          },
          {
            unitNumber: 6,
            title: 'Prevailing National Laws and Security Concepts',
            hours: '3 hrs',
            topics: [
              '6.1 Prevailing Laws in Nepal: Electronic Transaction Act (Chapter 9), The Privacy Act 2075 (Chapters 6, 9, 10), Cybersecurity Policy 2021',
              '6.2 Cyber Strategy of Government of Nepal, CERT Team, International Computer Laws (CFAA, DMCA), Open-Source Intelligence (OSINT), OWASP Top 10',
            ],
          },
        ],
        laboratoryWork: [
          '1. Email header forensic analysis.',
          '2. Network Forensics and packet capture inspection (Wireshark / Nmap).',
          '3. Windows Forensics Analysis (Registry, Event Logs, Disk/Memory imaging with FTK Imager / Autopsy).',
          '4. Operating System Hardening (Windows and Linux).',
        ],
        textbooks: [
          'William Oettinger, "Learn Computer Forensics", Packt Publishing.',
          'André Årnes, "Digital Forensics", Wiley & Sons Inc.',
        ],
        references: [
          'Bill Nelson et al., "Guide to Computer Forensics and Investigations", Cengage Learning.',
          'Michael Sikorski and Andrew Honig, "Practical Malware Analysis", No Starch Press.',
          'Michael Hale Ligh et al., "The Art of Memory Forensics", Wiley.',
          'Eoghan Casey, "Handbook of Digital Forensics and Investigation", Academic Press.',
        ],
      },
      {
        code: 'CIT323',
        title: 'Artificial Intelligence',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH + PR',
        totalHours: '45 hrs',
        year: 'Year 3',
        semester: 'VI',
        objectives: [
          'Provide a strong foundation in Artificial Intelligence concepts including intelligent agents, uninformed/informed search strategies, knowledge representation, predicate logic, neural networks, and AI applications.',
        ],
        outcomes: [
          'Design intelligent agents and solve state-space problems using A*, Greedy, Hill Climbing, and Constraint Satisfaction search.',
          'Represent knowledge using Propositional/First-Order Predicate Logic, Semantic Nets, Frames, Artificial Neural Networks, Fuzzy Logic, and NLP.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Introduction',
            hours: '4 hrs',
            topics: [
              '1.1 AI Perspectives: Acting and thinking humanly, Acting and thinking rationally',
              '1.2 Turing Test and Chinese Room Argument',
              '1.3 Foundations of AI & 1.4 Applications of AI',
            ],
          },
          {
            unitNumber: 2,
            title: 'Intelligent Agents',
            hours: '4 hrs',
            topics: [
              '2.1 Introduction, Structure, and Properties of Intelligent Agents',
              '2.2 Agents and Environments',
              '2.3 Agent Types: Simple Reflex, Model-Based, Goal-Based, Utility-Based',
              '2.4 Performance evaluation of agents: PEAS (Performance, Environment, Actuators, Sensors) description',
            ],
          },
          {
            unitNumber: 3,
            title: 'Problem Solving by Searching',
            hours: '9 hrs',
            topics: [
              '3.1 State-Space Search: Water Jug Problem, 8-Puzzle Problem',
              '3.2 Search Strategies and Performance Evaluation (Completeness, Optimality, Time/Space Complexity)',
              '3.3 Uninformed Search: Depth-First Search (DFS), Breadth-First Search (BFS), Depth-Limited Search, Bidirectional Search',
              '3.4 Informed (Heuristic) Search: Greedy Best-First Search, A* Search, Hill Climbing, Simulated Annealing',
              '3.5 Constraint Satisfaction Problems (CSP) and Backtracking Search',
            ],
          },
          {
            unitNumber: 4,
            title: 'Knowledge Representation',
            hours: '10 hrs',
            topics: [
              '4.1 Definition, Importance, Issues, and Properties of Knowledge Representation Systems',
              '4.2 Semantic Nets, Frames, and Rule-Based Systems',
              '4.3 Propositional Logic (PL): Syntax, Semantics, Forward Chaining, and Backward Chaining',
              '4.4 First-Order Predicate Logic (FOPL): Syntax, Semantics, Quantifiers, Clausal Normal Form, and Resolution Refutation',
            ],
          },
          {
            unitNumber: 5,
            title: 'Artificial Neural Networks',
            hours: '9 hrs',
            topics: [
              '5.1 Supervised, Unsupervised, and Reinforcement Learning concepts',
              '5.2 Biological vs. Artificial Neural Networks (ANN), Mathematical Model of a Neuron, Feed-forward, Recurrent, Single-Layer, and Multi-Layer networks',
              '5.3 Activation Functions and Gradient Descent',
              '5.4 Perceptron and Multilayer Perceptron (MLP) with Backpropagation Algorithm',
            ],
          },
          {
            unitNumber: 6,
            title: 'Applications of AI',
            hours: '9 hrs',
            topics: [
              '6.1 Expert Systems: Architecture, Knowledge Engineering, Case-Based Reasoning',
              '6.2 Natural Language Processing (NLP): Fundamentals, Steps, and Challenges',
              '6.3 Genetic Algorithms',
              '6.4 Fuzzy Logic and Fuzzy Inference Systems',
              "6.5 Bayes' Theorem and Probabilistic Reasoning",
            ],
          },
        ],
        laboratoryWork: [
          'Minimum 7 laboratory tasks on Predicate Calculus, State-Space Search, and Neural Networks using Prolog, LISP, or Python:',
          '• Family relationship and ancestor knowledge-base programs in Prolog',
          '• Recursive programs: Factorial, Fibonacci series, Tower of Hanoi (TOH)',
          '• Implementation of BFS, DFS, and A* search algorithms',
          '• Neural Network realization of logic gates (AND, OR, XOR)',
        ],
        references: [
          'Stuart Russell and Peter Norvig, "Artificial Intelligence: A Modern Approach", Prentice Hall.',
          'Elaine Rich and Kevin Knight, "Artificial Intelligence", McGraw-Hill.',
          'Stephen Lucci and Danny Kopec, "Artificial Intelligence in the 21st Century", Mercury Learning.',
          'David L. Poole and Alan K. Mackworth, "Artificial Intelligence: Foundations of Computational Agents", Cambridge University Press.',
        ],
      },
      {
        code: 'BCT322',
        title: 'Financial Accounting',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH',
        totalHours: '45 hrs',
        year: 'Year 3',
        semester: 'VI',
        objectives: [
          'Acquaint students with Generally Accepted Accounting Principles (GAAP), double-entry bookkeeping, adjusting entries, financial statements, accounting standards (NAS, NFRS, IFRS), receivables/liabilities, and cash internal controls.',
        ],
        outcomes: [
          'Journalize business transactions, post to ledgers, and prepare unadjusted and adjusted trial balances.',
          'Prepare and analyze Income Statements, Balance Sheets, Statements of Owner’s Equity, Cash Flow Statements, and Bank Reconciliation Statements.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Introduction to Accounting and Business',
            hours: '4 hrs',
            topics: [
              '1.1 Nature and types of businesses (Service, Merchandising, Manufacturing) and forms of business entities',
              '1.2 Cash vs. Accrual accounting, Users of accounting information, GAAP, Basic accounting concepts, Accounting equation',
              '1.3 Overview of Financial Statements and Ethics in Accounting',
            ],
          },
          {
            unitNumber: 2,
            title: 'Recording Business Transactions',
            hours: '10 hrs',
            topics: [
              '2.1 Source documents and basis for recording transactions',
              '2.2 Double-entry accounting system and the accounting equation',
              '2.3 Journalizing and posting to ledger accounts',
              '2.4 Sub-division of journal and preparing the Trial Balance',
            ],
          },
          {
            unitNumber: 3,
            title: 'The Adjusting Process',
            hours: '5 hrs',
            topics: [
              '3.1 Adjusting entries for accruals, deferrals, and depreciation',
              '3.2 Adjusted Trial Balance and preparing accounting worksheets',
            ],
          },
          {
            unitNumber: 4,
            title: 'Financial Statements and Accounting Cycle',
            hours: '10 hrs',
            topics: [
              '4.1 Annual corporate reports, independent audit reports, and types of financial statements',
              '4.2 Preparation of Balance Sheet and Income Statement',
              "4.3 Preparation of Statement of Owner's Equity and Statement of Cash Flows",
              '4.4 Closing entries and completing the Accounting Cycle',
            ],
          },
          {
            unitNumber: 5,
            title: 'Accounting Systems and Standards',
            hours: '5 hrs',
            topics: [
              '5.1 Manual vs. Computerized accounting systems',
              '5.2 Accounting Standards: NAS, IAS, NFRS, and IFRS',
            ],
          },
          {
            unitNumber: 6,
            title: 'Receivables and Current Liabilities',
            hours: '7 hrs',
            topics: [
              '6.1 Accounts receivable and Notes receivable: recognition, valuation, provision for doubtful debts and bad debts',
              '6.2 Current liabilities: Accounts payable, Tax payable, Contingent liabilities, and Balance Sheet presentation',
            ],
          },
          {
            unitNumber: 7,
            title: 'Financial Misrepresentation, Internal Control and Cash',
            hours: '4 hrs',
            topics: [
              '7.1 Financial statement misrepresentation and basic concepts of Forensic Accounting',
              '7.2 Internal control and cash controls over receipts and payments',
              '7.3 Bank accounts, Bank Reconciliation Statement, and Petty Cash Funds',
            ],
          },
        ],
        references: [
          'Carl S. Warren, James M. Reeve, and Jonathan E. Duchac, "Financial Accounting", Cengage Learning.',
          'Curtis L. Norton and Gary A. Porter, "Introduction to Financial Accounting", Cengage Learning.',
          'R. Narayanswamy, "Financial Accounting: A Managerial Perspective", PHI Learning.',
          'Accounting Standards Board (ASB), "Nepal Financial Reporting Standards (NFRS)", Kathmandu.',
        ],
      },
      {
        code: 'CIT324',
        title: 'Project III',
        credit: 3,
        creditDisplay: '3',
        nature: 'PR',
        year: 'Year 3',
        semester: 'VI',
        note: 'Carries 3 Credit Hours in the official 18-credit Semester VI / 138-credit BIT structure table (listed as 2 in the micro-syllabus header).',
        objectives: [
          'Develop practical project management, team collaboration, and software engineering skills by building an application using Java, PHP, Python, Computer Graphics, Mobile, or modern frameworks.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Phase I: Team Formation & Proposal Defense',
            topics: [
              'Form a team of 2–3 members, design a conceptual framework for a modern application, and defend the project proposal.',
            ],
          },
          {
            unitNumber: 2,
            title: 'Phase II: Weekly Supervisor Reporting & Architectural Design',
            topics: [
              'Submit weekly progress reports to the assigned supervisor, complete architectural design and validation schemes, and present the Midterm Progress Report to the internal evaluation committee.',
            ],
          },
          {
            unitNumber: 3,
            title: 'Phase III: Final Product Defense & Documentation',
            topics: [
              'Complete all software modules, submit the final project report, and defend the product before the final board examination and external examiner.',
            ],
          },
        ],
        projectGuidelines: {
          phases: [
            {
              title: 'First Phase',
              description:
                'Teams of 2–3 students formulate a conceptual framework and present a formal proposal to the department examiner.',
            },
            {
              title: 'Second Phase',
              description:
                'Groups submit weekly progress reports to their supervisor, complete system/architectural design and validation, and present to the internal evaluator committee.',
            },
            {
              title: 'Third Phase',
              description:
                'Students submit and defend the completed software product and final report before the final board examination in the presence of an external examiner.',
            },
          ],
          documentItems: [
            'Project Team members (2–3 students)',
            'Project supervisor(s)',
            'Technical description of the project',
            'Project Analysis, Design, Coding, Testing, and Implementation details',
          ],
        },
      },
    ],
  },
];
