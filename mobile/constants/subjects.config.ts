// Auto-generated static curriculum config for Semester Library Mobile
// Provides static Semester → Subject → Chapter definitions without requiring network calls.

export interface ChapterItem {
  id: string;
  title: string;
  unitNumber?: number;
  shortTitle?: string;
  isSpecial?: boolean;
}

export interface SubjectItem {
  code: string;
  title: string;
  credit?: string;
  chapters: ChapterItem[];
}

export interface SemesterItem {
  id: string; // 'Semester I', 'Semester II', etc.
  semester: string; // 'I', 'II', etc.
  label: string;
  shortLabel: string;
  year: string;
  subjects: SubjectItem[];
}

export const SEMESTERS: SemesterItem[] = [
  {
    "id": "Semester I",
    "semester": "I",
    "label": "Semester I",
    "shortLabel": "Semester 1",
    "year": "Year 1",
    "subjects": [
      {
        "code": "ELX111",
        "title": "Basic Electronics",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction to Circuit Theory",
            "title": "Unit 1: Introduction to Circuit Theory",
            "unitNumber": 1,
            "shortTitle": "Introduction to Circuit Theory"
          },
          {
            "id": "Unit 2: Semiconductor Diode",
            "title": "Unit 2: Semiconductor Diode",
            "unitNumber": 2,
            "shortTitle": "Semiconductor Diode"
          },
          {
            "id": "Unit 3: Transistor",
            "title": "Unit 3: Transistor",
            "unitNumber": 3,
            "shortTitle": "Transistor"
          },
          {
            "id": "Unit 4: Operational Amplifier",
            "title": "Unit 4: Operational Amplifier",
            "unitNumber": 4,
            "shortTitle": "Operational Amplifier"
          },
          {
            "id": "Unit 5: Introduction to Analog Communication System",
            "title": "Unit 5: Introduction to Analog Communication System",
            "unitNumber": 5,
            "shortTitle": "Introduction to Analog Communication System"
          },
          {
            "id": "Unit 6: Introduction to Digital Communication System",
            "title": "Unit 6: Introduction to Digital Communication System",
            "unitNumber": 6,
            "shortTitle": "Introduction to Digital Communication System"
          },
          {
            "id": "Unit 7: Application of Electronics System",
            "title": "Unit 7: Application of Electronics System",
            "unitNumber": 7,
            "shortTitle": "Application of Electronics System"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "BSM111",
        "title": "Mathematics I",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Derivatives",
            "title": "Unit 1: Derivatives",
            "unitNumber": 1,
            "shortTitle": "Derivatives"
          },
          {
            "id": "Unit 2: Applications of Derivatives",
            "title": "Unit 2: Applications of Derivatives",
            "unitNumber": 2,
            "shortTitle": "Applications of Derivatives"
          },
          {
            "id": "Unit 3: Integration and its application",
            "title": "Unit 3: Integration and its application",
            "unitNumber": 3,
            "shortTitle": "Integration and its application"
          },
          {
            "id": "Unit 4: Matrices and Determinants",
            "title": "Unit 4: Matrices and Determinants",
            "unitNumber": 4,
            "shortTitle": "Matrices and Determinants"
          },
          {
            "id": "Unit 5: Vectors",
            "title": "Unit 5: Vectors",
            "unitNumber": 5,
            "shortTitle": "Vectors"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "CIT111",
        "title": "Computer Programming,I (C)",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction",
            "title": "Unit 1: Introduction",
            "unitNumber": 1,
            "shortTitle": "Introduction"
          },
          {
            "id": "Unit 2: Problem Solving",
            "title": "Unit 2: Problem Solving",
            "unitNumber": 2,
            "shortTitle": "Problem Solving"
          },
          {
            "id": "Unit 3: Elements of C",
            "title": "Unit 3: Elements of C",
            "unitNumber": 3,
            "shortTitle": "Elements of C"
          },
          {
            "id": "Unit 4: Control Statements",
            "title": "Unit 4: Control Statements",
            "unitNumber": 4,
            "shortTitle": "Control Statements"
          },
          {
            "id": "Unit 5: Input and Output",
            "title": "Unit 5: Input and Output",
            "unitNumber": 5,
            "shortTitle": "Input and Output"
          },
          {
            "id": "Unit 6: Functions",
            "title": "Unit 6: Functions",
            "unitNumber": 6,
            "shortTitle": "Functions"
          },
          {
            "id": "Unit 7: Array and Strings",
            "title": "Unit 7: Array and Strings",
            "unitNumber": 7,
            "shortTitle": "Array and Strings"
          },
          {
            "id": "Unit 8: Structure and Unions",
            "title": "Unit 8: Structure and Unions",
            "unitNumber": 8,
            "shortTitle": "Structure and Unions"
          },
          {
            "id": "Unit 9: Pointers",
            "title": "Unit 9: Pointers",
            "unitNumber": 9,
            "shortTitle": "Pointers"
          },
          {
            "id": "Unit 10: File handling",
            "title": "Unit 10: File handling",
            "unitNumber": 10,
            "shortTitle": "File handling"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "CIT112",
        "title": "Basics of IT",
        "credit": "(3)",
        "chapters": [
          {
            "id": "Unit 1: Introduction to Information Technology",
            "title": "Unit 1: Introduction to Information Technology",
            "unitNumber": 1,
            "shortTitle": "Introduction to Information Technology"
          },
          {
            "id": "Unit 2: Computer Arithmetic",
            "title": "Unit 2: Computer Arithmetic",
            "unitNumber": 2,
            "shortTitle": "Computer Arithmetic"
          },
          {
            "id": "Unit 3: Information Technology Components",
            "title": "Unit 3: Information Technology Components",
            "unitNumber": 3,
            "shortTitle": "Information Technology Components"
          },
          {
            "id": "Unit 4: Computer Security",
            "title": "Unit 4: Computer Security",
            "unitNumber": 4,
            "shortTitle": "Computer Security"
          },
          {
            "id": "Unit 5: Applications of Information Technology and E-Commerce",
            "title": "Unit 5: Applications of Information Technology and E-Commerce",
            "unitNumber": 5,
            "shortTitle": "Applications of Information Technology and E-Commerce"
          },
          {
            "id": "Unit 6: Group Case Study and Report Presentation: Computer Based Infor-",
            "title": "Unit 6: Group Case Study and Report Presentation: Computer Based Infor-",
            "unitNumber": 6,
            "shortTitle": "Group Case Study and Report Presentation: Computer Based Infor-"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "CIT113",
        "title": "Workshop: Problem Solving and Logic",
        "credit": "1",
        "chapters": [
          {
            "id": "Unit 1: Introduction & Basics",
            "title": "Unit 1: Introduction & Basics",
            "unitNumber": 1,
            "shortTitle": "Introduction & Basics"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "BCT111",
        "title": "Business Communication Technique",
        "credit": "2",
        "chapters": [
          {
            "id": "Unit 1: Grammar",
            "title": "Unit 1: Grammar",
            "unitNumber": 1,
            "shortTitle": "Grammar"
          },
          {
            "id": "Unit 2: Sound System",
            "title": "Unit 2: Sound System",
            "unitNumber": 2,
            "shortTitle": "Sound System"
          },
          {
            "id": "Unit 3: Language Variety",
            "title": "Unit 3: Language Variety",
            "unitNumber": 3,
            "shortTitle": "Language Variety"
          },
          {
            "id": "Unit 4: Oral communication skills",
            "title": "Unit 4: Oral communication skills",
            "unitNumber": 4,
            "shortTitle": "Oral communication skills"
          },
          {
            "id": "Unit 5: Technical Talk: Meaning, procedure, presentation",
            "title": "Unit 5: Technical Talk: Meaning, procedure, presentation",
            "unitNumber": 5,
            "shortTitle": "Technical Talk: Meaning, procedure, presentation"
          },
          {
            "id": "Unit 6: Skills in Technical Writing",
            "title": "Unit 6: Skills in Technical Writing",
            "unitNumber": 6,
            "shortTitle": "Skills in Technical Writing"
          },
          {
            "id": "Unit 7: Textual Reading Skills",
            "title": "Unit 7: Textual Reading Skills",
            "unitNumber": 7,
            "shortTitle": "Textual Reading Skills"
          },
          {
            "id": "Unit 8: Note Taking",
            "title": "Unit 8: Note Taking",
            "unitNumber": 8,
            "shortTitle": "Note Taking"
          },
          {
            "id": "Unit 9: Tutorial Work",
            "title": "Unit 9: Tutorial Work",
            "unitNumber": 9,
            "shortTitle": "Tutorial Work"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      }
    ]
  },
  {
    "id": "Semester II",
    "semester": "II",
    "label": "Semester II",
    "shortLabel": "Semester 2",
    "year": "Year 1",
    "subjects": [
      {
        "code": "CIT121",
        "title": "Discrete Mathematics",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Logic and Induction",
            "title": "Unit 1: Logic and Induction",
            "unitNumber": 1,
            "shortTitle": "Logic and Induction"
          },
          {
            "id": "Unit 2: Mathematical Reasoning",
            "title": "Unit 2: Mathematical Reasoning",
            "unitNumber": 2,
            "shortTitle": "Mathematical Reasoning"
          },
          {
            "id": "Unit 3: Finite state Automata, Grammars and Languages",
            "title": "Unit 3: Finite state Automata, Grammars and Languages",
            "unitNumber": 3,
            "shortTitle": "Finite state Automata, Grammars and Languages"
          },
          {
            "id": "Unit 4: Recurrence Relation",
            "title": "Unit 4: Recurrence Relation",
            "unitNumber": 4,
            "shortTitle": "Recurrence Relation"
          },
          {
            "id": "Unit 5: Graph Theory",
            "title": "Unit 5: Graph Theory",
            "unitNumber": 5,
            "shortTitle": "Graph Theory"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "CIT122",
        "title": "Computer Programming II (Java)",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction to Object Oriented Programming",
            "title": "Unit 1: Introduction to Object Oriented Programming",
            "unitNumber": 1,
            "shortTitle": "Introduction to Object Oriented Programming"
          },
          {
            "id": "Unit 2: Introduction to Java",
            "title": "Unit 2: Introduction to Java",
            "unitNumber": 2,
            "shortTitle": "Introduction to Java"
          },
          {
            "id": "Unit 3: Java Basics",
            "title": "Unit 3: Java Basics",
            "unitNumber": 3,
            "shortTitle": "Java Basics"
          },
          {
            "id": "Unit 4: Operators and Control Flow",
            "title": "Unit 4: Operators and Control Flow",
            "unitNumber": 4,
            "shortTitle": "Operators and Control Flow"
          },
          {
            "id": "Unit 5: Inheritance, Package and Interface",
            "title": "Unit 5: Inheritance, Package and Interface",
            "unitNumber": 5,
            "shortTitle": "Inheritance, Package and Interface"
          },
          {
            "id": "Unit 6: Exceptions and streams",
            "title": "Unit 6: Exceptions and streams",
            "unitNumber": 6,
            "shortTitle": "Exceptions and streams"
          },
          {
            "id": "Unit 7: Java I/O and streams",
            "title": "Unit 7: Java I/O and streams",
            "unitNumber": 7,
            "shortTitle": "Java I/O and streams"
          },
          {
            "id": "Unit 8: Event Handling",
            "title": "Unit 8: Event Handling",
            "unitNumber": 8,
            "shortTitle": "Event Handling"
          },
          {
            "id": "Unit 9: GUI with AWT & Swing",
            "title": "Unit 9: GUI with AWT & Swing",
            "unitNumber": 9,
            "shortTitle": "GUI with AWT & Swing"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "BSM121",
        "title": "Mathematics II",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Permutation and Combination",
            "title": "Unit 1: Permutation and Combination",
            "unitNumber": 1,
            "shortTitle": "Permutation and Combination"
          },
          {
            "id": "Unit 2: Infinite Series",
            "title": "Unit 2: Infinite Series",
            "unitNumber": 2,
            "shortTitle": "Infinite Series"
          },
          {
            "id": "Unit 3: Function of Several Variables",
            "title": "Unit 3: Function of Several Variables",
            "unitNumber": 3,
            "shortTitle": "Function of Several Variables"
          },
          {
            "id": "Unit 4: Differential Equations",
            "title": "Unit 4: Differential Equations",
            "unitNumber": 4,
            "shortTitle": "Differential Equations"
          },
          {
            "id": "Unit 5: Functions of Complex Variable",
            "title": "Unit 5: Functions of Complex Variable",
            "unitNumber": 5,
            "shortTitle": "Functions of Complex Variable"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "ELX121",
        "title": "Digital Logic",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction to Digital Logic",
            "title": "Unit 1: Introduction to Digital Logic",
            "unitNumber": 1,
            "shortTitle": "Introduction to Digital Logic"
          },
          {
            "id": "Unit 2: Number System",
            "title": "Unit 2: Number System",
            "unitNumber": 2,
            "shortTitle": "Number System"
          },
          {
            "id": "Unit 3: Boolean Algebra",
            "title": "Unit 3: Boolean Algebra",
            "unitNumber": 3,
            "shortTitle": "Boolean Algebra"
          },
          {
            "id": "Unit 4: Combinational Circuits",
            "title": "Unit 4: Combinational Circuits",
            "unitNumber": 4,
            "shortTitle": "Combinational Circuits"
          },
          {
            "id": "Unit 5: Sequential Circuits",
            "title": "Unit 5: Sequential Circuits",
            "unitNumber": 5,
            "shortTitle": "Sequential Circuits"
          },
          {
            "id": "Unit 6: Counter and Register",
            "title": "Unit 6: Counter and Register",
            "unitNumber": 6,
            "shortTitle": "Counter and Register"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "CIT123",
        "title": "Web Technology I",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Basic Concept",
            "title": "Unit 1: Basic Concept",
            "unitNumber": 1,
            "shortTitle": "Basic Concept"
          },
          {
            "id": "Unit 2: HTML and XHTML",
            "title": "Unit 2: HTML and XHTML",
            "unitNumber": 2,
            "shortTitle": "HTML and XHTML"
          },
          {
            "id": "Unit 3: Introducing Cascading Style Sheet",
            "title": "Unit 3: Introducing Cascading Style Sheet",
            "unitNumber": 3,
            "shortTitle": "Introducing Cascading Style Sheet"
          },
          {
            "id": "Unit 4: Learning JavaScript",
            "title": "Unit 4: Learning JavaScript",
            "unitNumber": 4,
            "shortTitle": "Learning JavaScript"
          },
          {
            "id": "Unit 5: Programming in PHP and MYSQL",
            "title": "Unit 5: Programming in PHP and MYSQL",
            "unitNumber": 5,
            "shortTitle": "Programming in PHP and MYSQL"
          },
          {
            "id": "Unit 1: Every topic of the course content should be included for the lab.",
            "title": "Unit 1: Every topic of the course content should be included for the lab.",
            "unitNumber": 1,
            "shortTitle": "Every topic of the course content should be included for the lab."
          },
          {
            "id": "Unit 2: Individual or group project work to develop a web application should be",
            "title": "Unit 2: Individual or group project work to develop a web application should be",
            "unitNumber": 2,
            "shortTitle": "Individual or group project work to develop a web application should be"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "CIT124",
        "title": "Project I",
        "credit": "2",
        "chapters": [
          {
            "id": "Unit 1: Project must be chosen in an area related to Computer Science/IT/ICT/Software",
            "title": "Unit 1: Project must be chosen in an area related to Computer Science/IT/ICT/Software",
            "unitNumber": 1,
            "shortTitle": "Project must be chosen in an area related to Computer Science/IT/ICT/Software"
          },
          {
            "id": "Unit 2: A proposal including a literature survey must be submitted.",
            "title": "Unit 2: A proposal including a literature survey must be submitted.",
            "unitNumber": 2,
            "shortTitle": "A proposal including a literature survey must be submitted."
          },
          {
            "id": "Unit 3: A midterm progress report to be submitted.",
            "title": "Unit 3: A midterm progress report to be submitted.",
            "unitNumber": 3,
            "shortTitle": "A midterm progress report to be submitted."
          },
          {
            "id": "Unit 4: A oral presentation to be given.",
            "title": "Unit 4: A oral presentation to be given.",
            "unitNumber": 4,
            "shortTitle": "A oral presentation to be given."
          },
          {
            "id": "Unit 5: The final report to be submitted.",
            "title": "Unit 5: The final report to be submitted.",
            "unitNumber": 5,
            "shortTitle": "The final report to be submitted."
          },
          {
            "id": "Unit 6: The oral defense of the final report should be given.",
            "title": "Unit 6: The oral defense of the final report should be given.",
            "unitNumber": 6,
            "shortTitle": "The oral defense of the final report should be given."
          },
          {
            "id": "Unit 1: Project Team members At least 2 and maximum of 3",
            "title": "Unit 1: Project Team members At least 2 and maximum of 3",
            "unitNumber": 1,
            "shortTitle": "Project Team members At least 2 and maximum of 3"
          },
          {
            "id": "Unit 2: Project supervisors",
            "title": "Unit 2: Project supervisors",
            "unitNumber": 2,
            "shortTitle": "Project supervisors"
          },
          {
            "id": "Unit 3: Technical description of the project.",
            "title": "Unit 3: Technical description of the project.",
            "unitNumber": 3,
            "shortTitle": "Technical description of the project."
          },
          {
            "id": "Unit 4: Project Analysis, Design, Coding, Testing and Implementation details.",
            "title": "Unit 4: Project Analysis, Design, Coding, Testing and Implementation details.",
            "unitNumber": 4,
            "shortTitle": "Project Analysis, Design, Coding, Testing and Implementation details."
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      }
    ]
  },
  {
    "id": "Semester III",
    "semester": "III",
    "label": "Semester III",
    "shortLabel": "Semester 3",
    "year": "Year 2",
    "subjects": [
      {
        "code": "CIT214",
        "title": "Data Structure and Algorithms",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction",
            "title": "Unit 1: Introduction",
            "unitNumber": 1,
            "shortTitle": "Introduction"
          },
          {
            "id": "Unit 2: Linked Lists",
            "title": "Unit 2: Linked Lists",
            "unitNumber": 2,
            "shortTitle": "Linked Lists"
          },
          {
            "id": "Unit 3: Stacks, Queue and Recursion",
            "title": "Unit 3: Stacks, Queue and Recursion",
            "unitNumber": 3,
            "shortTitle": "Stacks, Queue and Recursion"
          },
          {
            "id": "Unit 4: Trees",
            "title": "Unit 4: Trees",
            "unitNumber": 4,
            "shortTitle": "Trees"
          },
          {
            "id": "Unit 5: Sorting",
            "title": "Unit 5: Sorting",
            "unitNumber": 5,
            "shortTitle": "Sorting"
          },
          {
            "id": "Unit 6: Searching and Hashing",
            "title": "Unit 6: Searching and Hashing",
            "unitNumber": 6,
            "shortTitle": "Searching and Hashing"
          },
          {
            "id": "Unit 7: Graph",
            "title": "Unit 7: Graph",
            "unitNumber": 7,
            "shortTitle": "Graph"
          },
          {
            "id": "Unit 8: Case Studies In Algorithms",
            "title": "Unit 8: Case Studies In Algorithms",
            "unitNumber": 8,
            "shortTitle": "Case Studies In Algorithms"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "CIT213",
        "title": "Database Management System",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction",
            "title": "Unit 1: Introduction",
            "unitNumber": 1,
            "shortTitle": "Introduction"
          },
          {
            "id": "Unit 2: Data Model",
            "title": "Unit 2: Data Model",
            "unitNumber": 2,
            "shortTitle": "Data Model"
          },
          {
            "id": "Unit 3: Relational Model",
            "title": "Unit 3: Relational Model",
            "unitNumber": 3,
            "shortTitle": "Relational Model"
          },
          {
            "id": "Unit 4: Relational Language and Database Constraints",
            "title": "Unit 4: Relational Language and Database Constraints",
            "unitNumber": 4,
            "shortTitle": "Relational Language and Database Constraints"
          },
          {
            "id": "Unit 5: Relational Database Design",
            "title": "Unit 5: Relational Database Design",
            "unitNumber": 5,
            "shortTitle": "Relational Database Design"
          },
          {
            "id": "Unit 6: Transaction management and concurrency control",
            "title": "Unit 6: Transaction management and concurrency control",
            "unitNumber": 6,
            "shortTitle": "Transaction management and concurrency control"
          },
          {
            "id": "Unit 7: Recovery System",
            "title": "Unit 7: Recovery System",
            "unitNumber": 7,
            "shortTitle": "Recovery System"
          },
          {
            "id": "Unit 8: Advanced Database Model",
            "title": "Unit 8: Advanced Database Model",
            "unitNumber": 8,
            "shortTitle": "Advanced Database Model"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "ELX211",
        "title": "Microprocessor and Computer Architecture",
        "credit": "4",
        "chapters": [
          {
            "id": "Unit 1: Fundamental of Microprocessor",
            "title": "Unit 1: Fundamental of Microprocessor",
            "unitNumber": 1,
            "shortTitle": "Fundamental of Microprocessor"
          },
          {
            "id": "Unit 2: Intel 8085",
            "title": "Unit 2: Intel 8085",
            "unitNumber": 2,
            "shortTitle": "Intel 8085"
          },
          {
            "id": "Unit 3: Overview of Intel 8086",
            "title": "Unit 3: Overview of Intel 8086",
            "unitNumber": 3,
            "shortTitle": "Overview of Intel 8086"
          },
          {
            "id": "Unit 4: Basic Computer Architecture and Microoperations",
            "title": "Unit 4: Basic Computer Architecture and Microoperations",
            "unitNumber": 4,
            "shortTitle": "Basic Computer Architecture and Microoperations"
          },
          {
            "id": "Unit 5: Control Unit and Central Processing Unit",
            "title": "Unit 5: Control Unit and Central Processing Unit",
            "unitNumber": 5,
            "shortTitle": "Control Unit and Central Processing Unit"
          },
          {
            "id": "Unit 6: Computer Arithmetic",
            "title": "Unit 6: Computer Arithmetic",
            "unitNumber": 6,
            "shortTitle": "Computer Arithmetic"
          },
          {
            "id": "Unit 7: Input and Output Organization",
            "title": "Unit 7: Input and Output Organization",
            "unitNumber": 7,
            "shortTitle": "Input and Output Organization"
          },
          {
            "id": "Unit 8: Memory Organization",
            "title": "Unit 8: Memory Organization",
            "unitNumber": 8,
            "shortTitle": "Memory Organization"
          },
          {
            "id": "Unit 9: Pipelining",
            "title": "Unit 9: Pipelining",
            "unitNumber": 9,
            "shortTitle": "Pipelining"
          },
          {
            "id": "Unit 10: Parallel Processing",
            "title": "Unit 10: Parallel Processing",
            "unitNumber": 10,
            "shortTitle": "Parallel Processing"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "BCT211",
        "title": "Principles of Organization and Management",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction to Management",
            "title": "Unit 1: Introduction to Management",
            "unitNumber": 1,
            "shortTitle": "Introduction to Management"
          },
          {
            "id": "Unit 2: Evolution of Management and the Environmental Context of Man-",
            "title": "Unit 2: Evolution of Management and the Environmental Context of Man-",
            "unitNumber": 2,
            "shortTitle": "Evolution of Management and the Environmental Context of Man-"
          },
          {
            "id": "Unit 3: The Planning and Decision Making",
            "title": "Unit 3: The Planning and Decision Making",
            "unitNumber": 3,
            "shortTitle": "The Planning and Decision Making"
          },
          {
            "id": "Unit 4: Organizing",
            "title": "Unit 4: Organizing",
            "unitNumber": 4,
            "shortTitle": "Organizing"
          },
          {
            "id": "Unit 5: Motivation and Leadership",
            "title": "Unit 5: Motivation and Leadership",
            "unitNumber": 5,
            "shortTitle": "Motivation and Leadership"
          },
          {
            "id": "Unit 6: Communication and Managing Workforce",
            "title": "Unit 6: Communication and Managing Workforce",
            "unitNumber": 6,
            "shortTitle": "Communication and Managing Workforce"
          },
          {
            "id": "Unit 7: Controlling",
            "title": "Unit 7: Controlling",
            "unitNumber": 7,
            "shortTitle": "Controlling"
          },
          {
            "id": "Unit 8: Functional areas of Management",
            "title": "Unit 8: Functional areas of Management",
            "unitNumber": 8,
            "shortTitle": "Functional areas of Management"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "CIT212",
        "title": "Software Engineering",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Software Engineering Fundamentals",
            "title": "Unit 1: Software Engineering Fundamentals",
            "unitNumber": 1,
            "shortTitle": "Software Engineering Fundamentals"
          },
          {
            "id": "Unit 2: Agile Software Development",
            "title": "Unit 2: Agile Software Development",
            "unitNumber": 2,
            "shortTitle": "Agile Software Development"
          },
          {
            "id": "Unit 3: Requirement Engineering",
            "title": "Unit 3: Requirement Engineering",
            "unitNumber": 3,
            "shortTitle": "Requirement Engineering"
          },
          {
            "id": "Unit 4: System Modeling",
            "title": "Unit 4: System Modeling",
            "unitNumber": 4,
            "shortTitle": "System Modeling"
          },
          {
            "id": "Unit 5: Architectural design",
            "title": "Unit 5: Architectural design",
            "unitNumber": 5,
            "shortTitle": "Architectural design"
          },
          {
            "id": "Unit 6: Design, reuse and implementation",
            "title": "Unit 6: Design, reuse and implementation",
            "unitNumber": 6,
            "shortTitle": "Design, reuse and implementation"
          },
          {
            "id": "Unit 7: Software testing and cost estimation",
            "title": "Unit 7: Software testing and cost estimation",
            "unitNumber": 7,
            "shortTitle": "Software testing and cost estimation"
          },
          {
            "id": "Unit 8: Quality Management",
            "title": "Unit 8: Quality Management",
            "unitNumber": 8,
            "shortTitle": "Quality Management"
          },
          {
            "id": "Unit 9: Configuration Management",
            "title": "Unit 9: Configuration Management",
            "unitNumber": 9,
            "shortTitle": "Configuration Management"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "CIT211",
        "title": "Web Technology II",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction",
            "title": "Unit 1: Introduction",
            "unitNumber": 1,
            "shortTitle": "Introduction"
          },
          {
            "id": "Unit 2: Styling more with CSS",
            "title": "Unit 2: Styling more with CSS",
            "unitNumber": 2,
            "shortTitle": "Styling more with CSS"
          },
          {
            "id": "Unit 3: AJAX and XML",
            "title": "Unit 3: AJAX and XML",
            "unitNumber": 3,
            "shortTitle": "AJAX and XML"
          },
          {
            "id": "Unit 4: Advanced JavaScript",
            "title": "Unit 4: Advanced JavaScript",
            "unitNumber": 4,
            "shortTitle": "Advanced JavaScript"
          },
          {
            "id": "Unit 5: Web Security",
            "title": "Unit 5: Web Security",
            "unitNumber": 5,
            "shortTitle": "Web Security"
          },
          {
            "id": "Unit 6: Combining Together",
            "title": "Unit 6: Combining Together",
            "unitNumber": 6,
            "shortTitle": "Combining Together"
          },
          {
            "id": "Unit 7: Web Application Development Frameworks",
            "title": "Unit 7: Web Application Development Frameworks",
            "unitNumber": 7,
            "shortTitle": "Web Application Development Frameworks"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      }
    ]
  },
  {
    "id": "Semester IV",
    "semester": "IV",
    "label": "Semester IV",
    "shortLabel": "Semester 4",
    "year": "Year 2",
    "subjects": [
      {
        "code": "CIT224",
        "title": "Computer Graphics Technology",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction of Computer Graphics",
            "title": "Unit 1: Introduction of Computer Graphics",
            "unitNumber": 1,
            "shortTitle": "Introduction of Computer Graphics"
          },
          {
            "id": "Unit 2: Scan Conversion Algorithms",
            "title": "Unit 2: Scan Conversion Algorithms",
            "unitNumber": 2,
            "shortTitle": "Scan Conversion Algorithms"
          },
          {
            "id": "Unit 3: Two Dimensional Geometric Transformations and Viewing",
            "title": "Unit 3: Two Dimensional Geometric Transformations and Viewing",
            "unitNumber": 3,
            "shortTitle": "Two Dimensional Geometric Transformations and Viewing"
          },
          {
            "id": "Unit 4: Three Dimensional Graph",
            "title": "Unit 4: Three Dimensional Graph",
            "unitNumber": 4,
            "shortTitle": "Three Dimensional Graph"
          },
          {
            "id": "Unit 5: Visible Surface Detection",
            "title": "Unit 5: Visible Surface Detection",
            "unitNumber": 5,
            "shortTitle": "Visible Surface Detection"
          },
          {
            "id": "Unit 6: Illumination and Shading",
            "title": "Unit 6: Illumination and Shading",
            "unitNumber": 6,
            "shortTitle": "Illumination and Shading"
          },
          {
            "id": "Unit 7: Introduction to Virtual Reality",
            "title": "Unit 7: Introduction to Virtual Reality",
            "unitNumber": 7,
            "shortTitle": "Introduction to Virtual Reality"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "CIT223",
        "title": "Data Communication and Computer Networks",
        "credit": "4",
        "chapters": [
          {
            "id": "Unit 1: Introduction to Computer Network and Data Communication",
            "title": "Unit 1: Introduction to Computer Network and Data Communication",
            "unitNumber": 1,
            "shortTitle": "Introduction to Computer Network and Data Communication"
          },
          {
            "id": "Unit 2: Physical Layer",
            "title": "Unit 2: Physical Layer",
            "unitNumber": 2,
            "shortTitle": "Physical Layer"
          },
          {
            "id": "Unit 3: Data-link Layer",
            "title": "Unit 3: Data-link Layer",
            "unitNumber": 3,
            "shortTitle": "Data-link Layer"
          },
          {
            "id": "Unit 4: Network Layer",
            "title": "Unit 4: Network Layer",
            "unitNumber": 4,
            "shortTitle": "Network Layer"
          },
          {
            "id": "Unit 5: Transport Layer and Application Layer",
            "title": "Unit 5: Transport Layer and Application Layer",
            "unitNumber": 5,
            "shortTitle": "Transport Layer and Application Layer"
          },
          {
            "id": "Unit 6: Network Essentials",
            "title": "Unit 6: Network Essentials",
            "unitNumber": 6,
            "shortTitle": "Network Essentials"
          },
          {
            "id": "Unit 7: Networking as a Career",
            "title": "Unit 7: Networking as a Career",
            "unitNumber": 7,
            "shortTitle": "Networking as a Career"
          },
          {
            "id": "Unit 8: Network Security",
            "title": "Unit 8: Network Security",
            "unitNumber": 8,
            "shortTitle": "Network Security"
          },
          {
            "id": "Unit 9: Network SCAMS",
            "title": "Unit 9: Network SCAMS",
            "unitNumber": 9,
            "shortTitle": "Network SCAMS"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "CIT222",
        "title": "Management Information System",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Foundations of Information Systems in Business",
            "title": "Unit 1: Foundations of Information Systems in Business",
            "unitNumber": 1,
            "shortTitle": "Foundations of Information Systems in Business"
          },
          {
            "id": "Unit 2: Competing with Information Technology",
            "title": "Unit 2: Competing with Information Technology",
            "unitNumber": 2,
            "shortTitle": "Competing with Information Technology"
          },
          {
            "id": "Unit 3: Data Resource Management",
            "title": "Unit 3: Data Resource Management",
            "unitNumber": 3,
            "shortTitle": "Data Resource Management"
          },
          {
            "id": "Unit 4: Decision Support System",
            "title": "Unit 4: Decision Support System",
            "unitNumber": 4,
            "shortTitle": "Decision Support System"
          },
          {
            "id": "Unit 5: Enterprise Business System",
            "title": "Unit 5: Enterprise Business System",
            "unitNumber": 5,
            "shortTitle": "Enterprise Business System"
          },
          {
            "id": "Unit 6: Developing Business Systems",
            "title": "Unit 6: Developing Business Systems",
            "unitNumber": 6,
            "shortTitle": "Developing Business Systems"
          },
          {
            "id": "Unit 7: Electronic Commerce Systems",
            "title": "Unit 7: Electronic Commerce Systems",
            "unitNumber": 7,
            "shortTitle": "Electronic Commerce Systems"
          },
          {
            "id": "Unit 8: Security and Ethical Challenges",
            "title": "Unit 8: Security and Ethical Challenges",
            "unitNumber": 8,
            "shortTitle": "Security and Ethical Challenges"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "CIT221",
        "title": "Operating Systems",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Operating System Overview",
            "title": "Unit 1: Operating System Overview",
            "unitNumber": 1,
            "shortTitle": "Operating System Overview"
          },
          {
            "id": "Unit 2: Process Management",
            "title": "Unit 2: Process Management",
            "unitNumber": 2,
            "shortTitle": "Process Management"
          },
          {
            "id": "Unit 3: Deadlock",
            "title": "Unit 3: Deadlock",
            "unitNumber": 3,
            "shortTitle": "Deadlock"
          },
          {
            "id": "Unit 4: Memory Management",
            "title": "Unit 4: Memory Management",
            "unitNumber": 4,
            "shortTitle": "Memory Management"
          },
          {
            "id": "Unit 5: File Management",
            "title": "Unit 5: File Management",
            "unitNumber": 5,
            "shortTitle": "File Management"
          },
          {
            "id": "Unit 6: I/O Management",
            "title": "Unit 6: I/O Management",
            "unitNumber": 6,
            "shortTitle": "I/O Management"
          },
          {
            "id": "Unit 7: Security",
            "title": "Unit 7: Security",
            "unitNumber": 7,
            "shortTitle": "Security"
          },
          {
            "id": "Unit 8: Case Study",
            "title": "Unit 8: Case Study",
            "unitNumber": 8,
            "shortTitle": "Case Study"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "BSM221",
        "title": "Fundamentals of Probability and Statistics",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Presentation of Data",
            "title": "Unit 1: Presentation of Data",
            "unitNumber": 1,
            "shortTitle": "Presentation of Data"
          },
          {
            "id": "Unit 2: Measures of Location and Dispersion",
            "title": "Unit 2: Measures of Location and Dispersion",
            "unitNumber": 2,
            "shortTitle": "Measures of Location and Dispersion"
          },
          {
            "id": "Unit 3: Probability and Probability Distribution",
            "title": "Unit 3: Probability and Probability Distribution",
            "unitNumber": 3,
            "shortTitle": "Probability and Probability Distribution"
          },
          {
            "id": "Unit 4: Sampling and Distribution of Sampling Statistics",
            "title": "Unit 4: Sampling and Distribution of Sampling Statistics",
            "unitNumber": 4,
            "shortTitle": "Sampling and Distribution of Sampling Statistics"
          },
          {
            "id": "Unit 5: Parameter Estimation",
            "title": "Unit 5: Parameter Estimation",
            "unitNumber": 5,
            "shortTitle": "Parameter Estimation"
          },
          {
            "id": "Unit 6: Hypothesis Testing",
            "title": "Unit 6: Hypothesis Testing",
            "unitNumber": 6,
            "shortTitle": "Hypothesis Testing"
          },
          {
            "id": "Unit 7: Simple Linear Correlation and Regression",
            "title": "Unit 7: Simple Linear Correlation and Regression",
            "unitNumber": 7,
            "shortTitle": "Simple Linear Correlation and Regression"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "CIT225",
        "title": "Project II",
        "credit": "2",
        "chapters": [
          {
            "id": "Unit 1: Introduction & Basics",
            "title": "Unit 1: Introduction & Basics",
            "unitNumber": 1,
            "shortTitle": "Introduction & Basics"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      }
    ]
  },
  {
    "id": "Semester V",
    "semester": "V",
    "label": "Semester V",
    "shortLabel": "Semester 5",
    "year": "Year 3",
    "subjects": [
      {
        "code": "BCT311",
        "title": "Economics",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction",
            "title": "Unit 1: Introduction",
            "unitNumber": 1,
            "shortTitle": "Introduction"
          },
          {
            "id": "Unit 2: Demand Supply and Elasticities",
            "title": "Unit 2: Demand Supply and Elasticities",
            "unitNumber": 2,
            "shortTitle": "Demand Supply and Elasticities"
          },
          {
            "id": "Unit 3: Theory of Consumer Behavior",
            "title": "Unit 3: Theory of Consumer Behavior",
            "unitNumber": 3,
            "shortTitle": "Theory of Consumer Behavior"
          },
          {
            "id": "Unit 4: Cost and Revenue Curves",
            "title": "Unit 4: Cost and Revenue Curves",
            "unitNumber": 4,
            "shortTitle": "Cost and Revenue Curves"
          },
          {
            "id": "Unit 5: Market Structure",
            "title": "Unit 5: Market Structure",
            "unitNumber": 5,
            "shortTitle": "Market Structure"
          },
          {
            "id": "Unit 6: National Income Accounting",
            "title": "Unit 6: National Income Accounting",
            "unitNumber": 6,
            "shortTitle": "National Income Accounting"
          },
          {
            "id": "Unit 7: Forms of Business Organization",
            "title": "Unit 7: Forms of Business Organization",
            "unitNumber": 7,
            "shortTitle": "Forms of Business Organization"
          },
          {
            "id": "Unit 8: Money, Inflation, Banking, and International Trade",
            "title": "Unit 8: Money, Inflation, Banking, and International Trade",
            "unitNumber": 8,
            "shortTitle": "Money, Inflation, Banking, and International Trade"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "CIT311",
        "title": "Mobile Application Development",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction to Mobile Application Development",
            "title": "Unit 1: Introduction to Mobile Application Development",
            "unitNumber": 1,
            "shortTitle": "Introduction to Mobile Application Development"
          },
          {
            "id": "Unit 2: Overview of Mobile Platforms",
            "title": "Unit 2: Overview of Mobile Platforms",
            "unitNumber": 2,
            "shortTitle": "Overview of Mobile Platforms"
          },
          {
            "id": "Unit 3: Mobile Application Architecture & Security",
            "title": "Unit 3: Mobile Application Architecture & Security",
            "unitNumber": 3,
            "shortTitle": "Mobile Application Architecture & Security"
          },
          {
            "id": "Unit 4: Introduction to Android Development",
            "title": "Unit 4: Introduction to Android Development",
            "unitNumber": 4,
            "shortTitle": "Introduction to Android Development"
          },
          {
            "id": "Unit 5: Testing and Debugging Mobile Applications",
            "title": "Unit 5: Testing and Debugging Mobile Applications",
            "unitNumber": 5,
            "shortTitle": "Testing and Debugging Mobile Applications"
          },
          {
            "id": "Unit 6: Deployment of Mobile Applications",
            "title": "Unit 6: Deployment of Mobile Applications",
            "unitNumber": 6,
            "shortTitle": "Deployment of Mobile Applications"
          },
          {
            "id": "Unit 7: Introduction to iOS Development",
            "title": "Unit 7: Introduction to iOS Development",
            "unitNumber": 7,
            "shortTitle": "Introduction to iOS Development"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "BSM311",
        "title": "Numerical Methods",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Concepts of Numerical Computing, Approximations and Errors4hrs",
            "title": "Unit 1: Concepts of Numerical Computing, Approximations and Errors4hrs",
            "unitNumber": 1,
            "shortTitle": "Concepts of Numerical Computing, Approximations and Errors4hrs"
          },
          {
            "id": "Unit 2: Numerical Method for Solving Nonlinear Equations",
            "title": "Unit 2: Numerical Method for Solving Nonlinear Equations",
            "unitNumber": 2,
            "shortTitle": "Numerical Method for Solving Nonlinear Equations"
          },
          {
            "id": "Unit 3: Solution of the System Linear Equations",
            "title": "Unit 3: Solution of the System Linear Equations",
            "unitNumber": 3,
            "shortTitle": "Solution of the System Linear Equations"
          },
          {
            "id": "Unit 4: Curve Fitting: Interpolation, Regression",
            "title": "Unit 4: Curve Fitting: Interpolation, Regression",
            "unitNumber": 4,
            "shortTitle": "Curve Fitting: Interpolation, Regression"
          },
          {
            "id": "Unit 5: Numerical Differentiation and Integration",
            "title": "Unit 5: Numerical Differentiation and Integration",
            "unitNumber": 5,
            "shortTitle": "Numerical Differentiation and Integration"
          },
          {
            "id": "Unit 6: Numerical Solutions of Differential Equations",
            "title": "Unit 6: Numerical Solutions of Differential Equations",
            "unitNumber": 6,
            "shortTitle": "Numerical Solutions of Differential Equations"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "CIT312",
        "title": "Object Oriented Analysis and Design using UML",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Object Oriented Fundamentals",
            "title": "Unit 1: Object Oriented Fundamentals",
            "unitNumber": 1,
            "shortTitle": "Object Oriented Fundamentals"
          },
          {
            "id": "Unit 2: Object Oriented Analysis",
            "title": "Unit 2: Object Oriented Analysis",
            "unitNumber": 2,
            "shortTitle": "Object Oriented Analysis"
          },
          {
            "id": "Unit 3: Object Oriented Design",
            "title": "Unit 3: Object Oriented Design",
            "unitNumber": 3,
            "shortTitle": "Object Oriented Design"
          },
          {
            "id": "Unit 4: Implementation",
            "title": "Unit 4: Implementation",
            "unitNumber": 4,
            "shortTitle": "Implementation"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "BCT312",
        "title": "Research Methodology",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction to the Research",
            "title": "Unit 1: Introduction to the Research",
            "unitNumber": 1,
            "shortTitle": "Introduction to the Research"
          },
          {
            "id": "Unit 2: Literature Review",
            "title": "Unit 2: Literature Review",
            "unitNumber": 2,
            "shortTitle": "Literature Review"
          },
          {
            "id": "Unit 3: Research Problem, Research Question, Theoretical and Conceptual",
            "title": "Unit 3: Research Problem, Research Question, Theoretical and Conceptual",
            "unitNumber": 3,
            "shortTitle": "Research Problem, Research Question, Theoretical and Conceptual"
          },
          {
            "id": "Unit 4: Research Design",
            "title": "Unit 4: Research Design",
            "unitNumber": 4,
            "shortTitle": "Research Design"
          },
          {
            "id": "Unit 5: Measurement, Scaling and Sampling",
            "title": "Unit 5: Measurement, Scaling and Sampling",
            "unitNumber": 5,
            "shortTitle": "Measurement, Scaling and Sampling"
          },
          {
            "id": "Unit 6: Data Collection and Analysis",
            "title": "Unit 6: Data Collection and Analysis",
            "unitNumber": 6,
            "shortTitle": "Data Collection and Analysis"
          },
          {
            "id": "Unit 7: Research Proposal and Scientific Writing",
            "title": "Unit 7: Research Proposal and Scientific Writing",
            "unitNumber": 7,
            "shortTitle": "Research Proposal and Scientific Writing"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "BCT313",
        "title": "Technical Proposal Writing",
        "credit": "1",
        "chapters": [
          {
            "id": "Unit 1: Basic Concept of Technical Proposal",
            "title": "Unit 1: Basic Concept of Technical Proposal",
            "unitNumber": 1,
            "shortTitle": "Basic Concept of Technical Proposal"
          },
          {
            "id": "Unit 2: Structuring the Technical Proposal",
            "title": "Unit 2: Structuring the Technical Proposal",
            "unitNumber": 2,
            "shortTitle": "Structuring the Technical Proposal"
          },
          {
            "id": "Unit 3: Grant Proposal and Contract Documents",
            "title": "Unit 3: Grant Proposal and Contract Documents",
            "unitNumber": 3,
            "shortTitle": "Grant Proposal and Contract Documents"
          },
          {
            "id": "Unit 4: Report Writing",
            "title": "Unit 4: Report Writing",
            "unitNumber": 4,
            "shortTitle": "Report Writing"
          },
          {
            "id": "Unit 5: Research Project Work and Technical Writing",
            "title": "Unit 5: Research Project Work and Technical Writing",
            "unitNumber": 5,
            "shortTitle": "Research Project Work and Technical Writing"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      }
    ]
  },
  {
    "id": "Semester VI",
    "semester": "VI",
    "label": "Semester VI",
    "shortLabel": "Semester 6",
    "year": "Year 3",
    "subjects": [
      {
        "code": "CIT323",
        "title": "Artificial Intelligence",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction",
            "title": "Unit 1: Introduction",
            "unitNumber": 1,
            "shortTitle": "Introduction"
          },
          {
            "id": "Unit 2: Intelligent Agents",
            "title": "Unit 2: Intelligent Agents",
            "unitNumber": 2,
            "shortTitle": "Intelligent Agents"
          },
          {
            "id": "Unit 3: Problem Solving by Searching",
            "title": "Unit 3: Problem Solving by Searching",
            "unitNumber": 3,
            "shortTitle": "Problem Solving by Searching"
          },
          {
            "id": "Unit 4: Knowledge Representation",
            "title": "Unit 4: Knowledge Representation",
            "unitNumber": 4,
            "shortTitle": "Knowledge Representation"
          },
          {
            "id": "Unit 5: Artificial Neural Networks",
            "title": "Unit 5: Artificial Neural Networks",
            "unitNumber": 5,
            "shortTitle": "Artificial Neural Networks"
          },
          {
            "id": "Unit 6: Applications of AI",
            "title": "Unit 6: Applications of AI",
            "unitNumber": 6,
            "shortTitle": "Applications of AI"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "CIT322",
        "title": "Digital Forensic Security Technologies",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction and basic concepts",
            "title": "Unit 1: Introduction and basic concepts",
            "unitNumber": 1,
            "shortTitle": "Introduction and basic concepts"
          },
          {
            "id": "Unit 2: Basic Security Concepts",
            "title": "Unit 2: Basic Security Concepts",
            "unitNumber": 2,
            "shortTitle": "Basic Security Concepts"
          },
          {
            "id": "Unit 3: Cybersecurity and Cybercrime",
            "title": "Unit 3: Cybersecurity and Cybercrime",
            "unitNumber": 3,
            "shortTitle": "Cybersecurity and Cybercrime"
          },
          {
            "id": "Unit 4: Computer Forensics Technology",
            "title": "Unit 4: Computer Forensics Technology",
            "unitNumber": 4,
            "shortTitle": "Computer Forensics Technology"
          },
          {
            "id": "Unit 5: Operating System Investigation",
            "title": "Unit 5: Operating System Investigation",
            "unitNumber": 5,
            "shortTitle": "Operating System Investigation"
          },
          {
            "id": "Unit 6: Prevailing National Laws and Security Concepts",
            "title": "Unit 6: Prevailing National Laws and Security Concepts",
            "unitNumber": 6,
            "shortTitle": "Prevailing National Laws and Security Concepts"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "BCT322",
        "title": "Financial Accounting",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction to Accounting and Business",
            "title": "Unit 1: Introduction to Accounting and Business",
            "unitNumber": 1,
            "shortTitle": "Introduction to Accounting and Business"
          },
          {
            "id": "Unit 2: Recording Business Transactions",
            "title": "Unit 2: Recording Business Transactions",
            "unitNumber": 2,
            "shortTitle": "Recording Business Transactions"
          },
          {
            "id": "Unit 3: The Adjusting Process",
            "title": "Unit 3: The Adjusting Process",
            "unitNumber": 3,
            "shortTitle": "The Adjusting Process"
          },
          {
            "id": "Unit 4: Financial Statements and Accounting Cycle",
            "title": "Unit 4: Financial Statements and Accounting Cycle",
            "unitNumber": 4,
            "shortTitle": "Financial Statements and Accounting Cycle"
          },
          {
            "id": "Unit 5: Accounting Systems and Standard",
            "title": "Unit 5: Accounting Systems and Standard",
            "unitNumber": 5,
            "shortTitle": "Accounting Systems and Standard"
          },
          {
            "id": "Unit 6: Receivable and Current Liabilities",
            "title": "Unit 6: Receivable and Current Liabilities",
            "unitNumber": 6,
            "shortTitle": "Receivable and Current Liabilities"
          },
          {
            "id": "Unit 7: Financial Misrepresentation, Internal Control and Cash",
            "title": "Unit 7: Financial Misrepresentation, Internal Control and Cash",
            "unitNumber": 7,
            "shortTitle": "Financial Misrepresentation, Internal Control and Cash"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "CIT321",
        "title": "Human Computer Interface and UI Design",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction and Overview",
            "title": "Unit 1: Introduction and Overview",
            "unitNumber": 1,
            "shortTitle": "Introduction and Overview"
          },
          {
            "id": "Unit 2: Characteristics of Graphical and Web User Interfaces",
            "title": "Unit 2: Characteristics of Graphical and Web User Interfaces",
            "unitNumber": 2,
            "shortTitle": "Characteristics of Graphical and Web User Interfaces"
          },
          {
            "id": "Unit 3: Usability Engineering",
            "title": "Unit 3: Usability Engineering",
            "unitNumber": 3,
            "shortTitle": "Usability Engineering"
          },
          {
            "id": "Unit 4: The Usability Engineering Lifecycle 4 User Profiling",
            "title": "Unit 4: The Usability Engineering Lifecycle 4 User Profiling",
            "unitNumber": 4,
            "shortTitle": "The Usability Engineering Lifecycle 4 User Profiling"
          },
          {
            "id": "Unit 5: Identifying needs and establishing requirements",
            "title": "Unit 5: Identifying needs and establishing requirements",
            "unitNumber": 5,
            "shortTitle": "Identifying needs and establishing requirements"
          },
          {
            "id": "Unit 6: Prototyping and Construction",
            "title": "Unit 6: Prototyping and Construction",
            "unitNumber": 6,
            "shortTitle": "Prototyping and Construction"
          },
          {
            "id": "Unit 7: Conceptual and Physical Design",
            "title": "Unit 7: Conceptual and Physical Design",
            "unitNumber": 7,
            "shortTitle": "Conceptual and Physical Design"
          },
          {
            "id": "Unit 8: User-centered approaches to interaction design",
            "title": "Unit 8: User-centered approaches to interaction design",
            "unitNumber": 8,
            "shortTitle": "User-centered approaches to interaction design"
          },
          {
            "id": "Unit 9: Evaluation",
            "title": "Unit 9: Evaluation",
            "unitNumber": 9,
            "shortTitle": "Evaluation"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "BCT321",
        "title": "IT Project Management",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction",
            "title": "Unit 1: Introduction",
            "unitNumber": 1,
            "shortTitle": "Introduction"
          },
          {
            "id": "Unit 2: Project Analysis and Time Management",
            "title": "Unit 2: Project Analysis and Time Management",
            "unitNumber": 2,
            "shortTitle": "Project Analysis and Time Management"
          },
          {
            "id": "Unit 3: Project Cost Management Process",
            "title": "Unit 3: Project Cost Management Process",
            "unitNumber": 3,
            "shortTitle": "Project Cost Management Process"
          },
          {
            "id": "Unit 4: Project Quality Management",
            "title": "Unit 4: Project Quality Management",
            "unitNumber": 4,
            "shortTitle": "Project Quality Management"
          },
          {
            "id": "Unit 5: Project Communication Management",
            "title": "Unit 5: Project Communication Management",
            "unitNumber": 5,
            "shortTitle": "Project Communication Management"
          },
          {
            "id": "Unit 6: Project Risk Management",
            "title": "Unit 6: Project Risk Management",
            "unitNumber": 6,
            "shortTitle": "Project Risk Management"
          },
          {
            "id": "Unit 7: Project Procurement Management",
            "title": "Unit 7: Project Procurement Management",
            "unitNumber": 7,
            "shortTitle": "Project Procurement Management"
          },
          {
            "id": "Unit 8: Custom Process in IT projects",
            "title": "Unit 8: Custom Process in IT projects",
            "unitNumber": 8,
            "shortTitle": "Custom Process in IT projects"
          },
          {
            "id": "Unit 9: Case Study",
            "title": "Unit 9: Case Study",
            "unitNumber": 9,
            "shortTitle": "Case Study"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "CIT324",
        "title": "Project III",
        "credit": "2",
        "chapters": [
          {
            "id": "Unit 1: Introduction & Basics",
            "title": "Unit 1: Introduction & Basics",
            "unitNumber": 1,
            "shortTitle": "Introduction & Basics"
          },
          {
            "id": "Unit 1: Project Team members At least 2 and maximum of 3",
            "title": "Unit 1: Project Team members At least 2 and maximum of 3",
            "unitNumber": 1,
            "shortTitle": "Project Team members At least 2 and maximum of 3"
          },
          {
            "id": "Unit 2: Project supervisors",
            "title": "Unit 2: Project supervisors",
            "unitNumber": 2,
            "shortTitle": "Project supervisors"
          },
          {
            "id": "Unit 3: Technical description of the project.",
            "title": "Unit 3: Technical description of the project.",
            "unitNumber": 3,
            "shortTitle": "Technical description of the project."
          },
          {
            "id": "Unit 4: Project Analysis, Design, Coding, Testing and Implementation details.",
            "title": "Unit 4: Project Analysis, Design, Coding, Testing and Implementation details.",
            "unitNumber": 4,
            "shortTitle": "Project Analysis, Design, Coding, Testing and Implementation details."
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      }
    ]
  },
  {
    "id": "Semester VII",
    "semester": "VII",
    "label": "Semester VII",
    "shortLabel": "Semester 7",
    "year": "Year 4",
    "subjects": [
      {
        "code": "CIT413",
        "title": "Cloud Computing",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction to Cloud Computing",
            "title": "Unit 1: Introduction to Cloud Computing",
            "unitNumber": 1,
            "shortTitle": "Introduction to Cloud Computing"
          },
          {
            "id": "Unit 2: Cloud Virtualization technology",
            "title": "Unit 2: Cloud Virtualization technology",
            "unitNumber": 2,
            "shortTitle": "Cloud Virtualization technology"
          },
          {
            "id": "Unit 3: Cloud Virtualization Technology",
            "title": "Unit 3: Cloud Virtualization Technology",
            "unitNumber": 3,
            "shortTitle": "Cloud Virtualization Technology"
          },
          {
            "id": "Unit 4: Service Oriented Computing",
            "title": "Unit 4: Service Oriented Computing",
            "unitNumber": 4,
            "shortTitle": "Service Oriented Computing"
          },
          {
            "id": "Unit 5: Storage in Cloud Computing",
            "title": "Unit 5: Storage in Cloud Computing",
            "unitNumber": 5,
            "shortTitle": "Storage in Cloud Computing"
          },
          {
            "id": "Unit 6: Resource management in Cloud Computing",
            "title": "Unit 6: Resource management in Cloud Computing",
            "unitNumber": 6,
            "shortTitle": "Resource management in Cloud Computing"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "CIT411",
        "title": "Data Mining and Warehousing",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction to Data Mining",
            "title": "Unit 1: Introduction to Data Mining",
            "unitNumber": 1,
            "shortTitle": "Introduction to Data Mining"
          },
          {
            "id": "Unit 2: Data Preprocessing",
            "title": "Unit 2: Data Preprocessing",
            "unitNumber": 2,
            "shortTitle": "Data Preprocessing"
          },
          {
            "id": "Unit 3: Data Warehousing and Online Analytical Processing",
            "title": "Unit 3: Data Warehousing and Online Analytical Processing",
            "unitNumber": 3,
            "shortTitle": "Data Warehousing and Online Analytical Processing"
          },
          {
            "id": "Unit 4: Classification",
            "title": "Unit 4: Classification",
            "unitNumber": 4,
            "shortTitle": "Classification"
          },
          {
            "id": "Unit 5: Association Analysis",
            "title": "Unit 5: Association Analysis",
            "unitNumber": 5,
            "shortTitle": "Association Analysis"
          },
          {
            "id": "Unit 6: Cluster Analysis",
            "title": "Unit 6: Cluster Analysis",
            "unitNumber": 6,
            "shortTitle": "Cluster Analysis"
          },
          {
            "id": "Unit 7: Anomaly Detection",
            "title": "Unit 7: Anomaly Detection",
            "unitNumber": 7,
            "shortTitle": "Anomaly Detection"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "CIT412",
        "title": "Software Development and Operations (DevOps)",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction",
            "title": "Unit 1: Introduction",
            "unitNumber": 1,
            "shortTitle": "Introduction"
          },
          {
            "id": "Unit 2: DevOps Basics with Virtualization",
            "title": "Unit 2: DevOps Basics with Virtualization",
            "unitNumber": 2,
            "shortTitle": "DevOps Basics with Virtualization"
          },
          {
            "id": "Unit 3: DevOps on Cloud",
            "title": "Unit 3: DevOps on Cloud",
            "unitNumber": 3,
            "shortTitle": "DevOps on Cloud"
          },
          {
            "id": "Unit 4: GIT- A Version Controlling Tool",
            "title": "Unit 4: GIT- A Version Controlling Tool",
            "unitNumber": 4,
            "shortTitle": "GIT- A Version Controlling Tool"
          },
          {
            "id": "Unit 5: Jenkins",
            "title": "Unit 5: Jenkins",
            "unitNumber": 5,
            "shortTitle": "Jenkins"
          },
          {
            "id": "Unit 6: Docker",
            "title": "Unit 6: Docker",
            "unitNumber": 6,
            "shortTitle": "Docker"
          },
          {
            "id": "Unit 7: Kubernetes",
            "title": "Unit 7: Kubernetes",
            "unitNumber": 7,
            "shortTitle": "Kubernetes"
          },
          {
            "id": "Unit 8: Ansible",
            "title": "Unit 8: Ansible",
            "unitNumber": 8,
            "shortTitle": "Ansible"
          },
          {
            "id": "Unit 1: Study on different search engines like Google, Bing etc and key business",
            "title": "Unit 1: Study on different search engines like Google, Bing etc and key business",
            "unitNumber": 1,
            "shortTitle": "Study on different search engines like Google, Bing etc and key business"
          },
          {
            "id": "Unit 2: Study of different web development frameworks for SEO.",
            "title": "Unit 2: Study of different web development frameworks for SEO.",
            "unitNumber": 2,
            "shortTitle": "Study of different web development frameworks for SEO."
          },
          {
            "id": "Unit 3: A case study of SEO and digital marketing in a businesschoosen by",
            "title": "Unit 3: A case study of SEO and digital marketing in a businesschoosen by",
            "unitNumber": 3,
            "shortTitle": "A case study of SEO and digital marketing in a businesschoosen by"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "BCT411",
        "title": "Technology Entrepreneurship",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction to Technology Entrepreneurship",
            "title": "Unit 1: Introduction to Technology Entrepreneurship",
            "unitNumber": 1,
            "shortTitle": "Introduction to Technology Entrepreneurship"
          },
          {
            "id": "Unit 2: Technology Entrepreneur Development",
            "title": "Unit 2: Technology Entrepreneur Development",
            "unitNumber": 2,
            "shortTitle": "Technology Entrepreneur Development"
          },
          {
            "id": "Unit 3: Opportunity identification and Analysis",
            "title": "Unit 3: Opportunity identification and Analysis",
            "unitNumber": 3,
            "shortTitle": "Opportunity identification and Analysis"
          },
          {
            "id": "Unit 4: Development of IT Business Plan and Modeling",
            "title": "Unit 4: Development of IT Business Plan and Modeling",
            "unitNumber": 4,
            "shortTitle": "Development of IT Business Plan and Modeling"
          },
          {
            "id": "Unit 5: Learn StartUp in Software Development",
            "title": "Unit 5: Learn StartUp in Software Development",
            "unitNumber": 5,
            "shortTitle": "Learn StartUp in Software Development"
          },
          {
            "id": "Unit 6: IT Product Development, Marketing and Financial Management8hrs",
            "title": "Unit 6: IT Product Development, Marketing and Financial Management8hrs",
            "unitNumber": 6,
            "shortTitle": "IT Product Development, Marketing and Financial Management8hrs"
          },
          {
            "id": "Unit 7: Technology Intellectual Property, Legal and Regulatory",
            "title": "Unit 7: Technology Intellectual Property, Legal and Regulatory",
            "unitNumber": 7,
            "shortTitle": "Technology Intellectual Property, Legal and Regulatory"
          },
          {
            "id": "Unit 8: Pitching and fundraising",
            "title": "Unit 8: Pitching and fundraising",
            "unitNumber": 8,
            "shortTitle": "Pitching and fundraising"
          },
          {
            "id": "Unit 9: Scaling and growth",
            "title": "Unit 9: Scaling and growth",
            "unitNumber": 9,
            "shortTitle": "Scaling and growth"
          },
          {
            "id": "Unit 10: Technology Entrepreneurial Mindset",
            "title": "Unit 10: Technology Entrepreneurial Mindset",
            "unitNumber": 10,
            "shortTitle": "Technology Entrepreneurial Mindset"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "CIT414",
        "title": "Wireless Communication Systems",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction",
            "title": "Unit 1: Introduction",
            "unitNumber": 1,
            "shortTitle": "Introduction"
          },
          {
            "id": "Unit 2: Fundamental of Cellular mobile Communication",
            "title": "Unit 2: Fundamental of Cellular mobile Communication",
            "unitNumber": 2,
            "shortTitle": "Fundamental of Cellular mobile Communication"
          },
          {
            "id": "Unit 3: Modulation/Multiple Access Technique",
            "title": "Unit 3: Modulation/Multiple Access Technique",
            "unitNumber": 3,
            "shortTitle": "Modulation/Multiple Access Technique"
          },
          {
            "id": "Unit 4: Radio wave Propagation/ Propagation Loss in Mobile Network",
            "title": "Unit 4: Radio wave Propagation/ Propagation Loss in Mobile Network",
            "unitNumber": 4,
            "shortTitle": "Radio wave Propagation/ Propagation Loss in Mobile Network"
          },
          {
            "id": "Unit 5: Global System for Mobile Communication GSM",
            "title": "Unit 5: Global System for Mobile Communication GSM",
            "unitNumber": 5,
            "shortTitle": "Global System for Mobile Communication GSM"
          },
          {
            "id": "Unit 6: Recent Trends in Wireless Communication",
            "title": "Unit 6: Recent Trends in Wireless Communication",
            "unitNumber": 6,
            "shortTitle": "Recent Trends in Wireless Communication"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      }
    ]
  },
  {
    "id": "Semester VIII",
    "semester": "VIII",
    "label": "Semester VIII",
    "shortLabel": "Semester 8",
    "year": "Year 4",
    "subjects": [
      {
        "code": "CIT421",
        "title": "Big Data Technologies",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction To Big Data And Hadoop",
            "title": "Unit 1: Introduction To Big Data And Hadoop",
            "unitNumber": 1,
            "shortTitle": "Introduction To Big Data And Hadoop"
          },
          {
            "id": "Unit 2: Google File System And Map Reduce Framework",
            "title": "Unit 2: Google File System And Map Reduce Framework",
            "unitNumber": 2,
            "shortTitle": "Google File System And Map Reduce Framework"
          },
          {
            "id": "Unit 3: Apache Hadoop And HDFSHadoop Distributed File System",
            "title": "Unit 3: Apache Hadoop And HDFSHadoop Distributed File System",
            "unitNumber": 3,
            "shortTitle": "Apache Hadoop And HDFSHadoop Distributed File System"
          },
          {
            "id": "Unit 4: Hadoop EcoSystem",
            "title": "Unit 4: Hadoop EcoSystem",
            "unitNumber": 4,
            "shortTitle": "Hadoop EcoSystem"
          },
          {
            "id": "Unit 5: Searching And Indexing",
            "title": "Unit 5: Searching And Indexing",
            "unitNumber": 5,
            "shortTitle": "Searching And Indexing"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "BCT421",
        "title": "Society, IT and Law",
        "credit": "3",
        "chapters": [
          {
            "id": "Unit 1: Introduction to Society, IT, and Law",
            "title": "Unit 1: Introduction to Society, IT, and Law",
            "unitNumber": 1,
            "shortTitle": "Introduction to Society, IT, and Law"
          },
          {
            "id": "Unit 2: Ethical and Social Implications of IT",
            "title": "Unit 2: Ethical and Social Implications of IT",
            "unitNumber": 2,
            "shortTitle": "Ethical and Social Implications of IT"
          },
          {
            "id": "Unit 3: Intellectual Property Law",
            "title": "Unit 3: Intellectual Property Law",
            "unitNumber": 3,
            "shortTitle": "Intellectual Property Law"
          },
          {
            "id": "Unit 4: Cybercrime and Cybersecurity Law",
            "title": "Unit 4: Cybercrime and Cybersecurity Law",
            "unitNumber": 4,
            "shortTitle": "Cybercrime and Cybersecurity Law"
          },
          {
            "id": "Unit 5: E-Commerce and Consumer Protection Law",
            "title": "Unit 5: E-Commerce and Consumer Protection Law",
            "unitNumber": 5,
            "shortTitle": "E-Commerce and Consumer Protection Law"
          },
          {
            "id": "Unit 6: International and Comparative Law",
            "title": "Unit 6: International and Comparative Law",
            "unitNumber": 6,
            "shortTitle": "International and Comparative Law"
          },
          {
            "id": "Unit 7: Emerging Issues in Society, IT, and Law",
            "title": "Unit 7: Emerging Issues in Society, IT, and Law",
            "unitNumber": 7,
            "shortTitle": "Emerging Issues in Society, IT, and Law"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "CIT422",
        "title": "Internship",
        "credit": "2",
        "chapters": [
          {
            "id": "Unit 1: Introduction to Internship",
            "title": "Unit 1: Introduction to Internship",
            "unitNumber": 1,
            "shortTitle": "Introduction to Internship"
          },
          {
            "id": "Unit 2: Understanding the organization",
            "title": "Unit 2: Understanding the organization",
            "unitNumber": 2,
            "shortTitle": "Understanding the organization"
          },
          {
            "id": "Unit 3: Collaborating in a project",
            "title": "Unit 3: Collaborating in a project",
            "unitNumber": 3,
            "shortTitle": "Collaborating in a project"
          },
          {
            "id": "Unit 4: Undertaking own Project",
            "title": "Unit 4: Undertaking own Project",
            "unitNumber": 4,
            "shortTitle": "Undertaking own Project"
          },
          {
            "id": "Unit 5: Reporting",
            "title": "Unit 5: Reporting",
            "unitNumber": 5,
            "shortTitle": "Reporting"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      },
      {
        "code": "CIT423",
        "title": "Project IV",
        "credit": "6",
        "chapters": [
          {
            "id": "Unit 1: Introduction & Basics",
            "title": "Unit 1: Introduction & Basics",
            "unitNumber": 1,
            "shortTitle": "Introduction & Basics"
          },
          {
            "id": "Unit 1: Proposal Submission and Presentation: Students must submit and",
            "title": "Unit 1: Proposal Submission and Presentation: Students must submit and",
            "unitNumber": 1,
            "shortTitle": "Proposal Submission and Presentation: Students must submit and"
          },
          {
            "id": "Unit 2: Mid-Term: Students must submit progress report and should defend",
            "title": "Unit 2: Mid-Term: Students must submit progress report and should defend",
            "unitNumber": 2,
            "shortTitle": "Mid-Term: Students must submit progress report and should defend"
          },
          {
            "id": "Unit 3: Final Submission: Students must submit and defend the project work",
            "title": "Unit 3: Final Submission: Students must submit and defend the project work",
            "unitNumber": 3,
            "shortTitle": "Final Submission: Students must submit and defend the project work"
          },
          {
            "id": "Unit 1: Prescribed content flow for the project proposal",
            "title": "Unit 1: Prescribed content flow for the project proposal",
            "unitNumber": 1,
            "shortTitle": "Prescribed content flow for the project proposal"
          },
          {
            "id": "Unit 2: Prescribed Content for the project report",
            "title": "Unit 2: Prescribed Content for the project report",
            "unitNumber": 2,
            "shortTitle": "Prescribed Content for the project report"
          },
          {
            "id": "Unit 1: Proposal Submission and Presentation: Students must submit and",
            "title": "Unit 1: Proposal Submission and Presentation: Students must submit and",
            "unitNumber": 1,
            "shortTitle": "Proposal Submission and Presentation: Students must submit and"
          },
          {
            "id": "Unit 2: Mid-Term: Students must submit progress report and should defend",
            "title": "Unit 2: Mid-Term: Students must submit progress report and should defend",
            "unitNumber": 2,
            "shortTitle": "Mid-Term: Students must submit progress report and should defend"
          },
          {
            "id": "Unit 3: Final Submission: Students must submit and defend the project work",
            "title": "Unit 3: Final Submission: Students must submit and defend the project work",
            "unitNumber": 3,
            "shortTitle": "Final Submission: Students must submit and defend the project work"
          },
          {
            "id": "Unit 1: Prescribed content flow for the project proposal",
            "title": "Unit 1: Prescribed content flow for the project proposal",
            "unitNumber": 1,
            "shortTitle": "Prescribed content flow for the project proposal"
          },
          {
            "id": "Unit 2: Prescribed Content for the project report",
            "title": "Unit 2: Prescribed Content for the project report",
            "unitNumber": 2,
            "shortTitle": "Prescribed Content for the project report"
          },
          {
            "id": "PYQS",
            "title": "Previous Year Questions (PYQs)",
            "isSpecial": true
          },
          {
            "id": "Books",
            "title": "Reference Books & Guides",
            "isSpecial": true
          },
          {
            "id": "General",
            "title": "General & Supplementary",
            "isSpecial": true
          }
        ]
      }
    ]
  }
];

export function getSemesters(): SemesterItem[] {
  return SEMESTERS;
}

export function getSemesterById(semesterId: string): SemesterItem | undefined {
  return SEMESTERS.find(s => s.id === semesterId || s.semester === semesterId);
}

export function getSubjectsForSemester(semesterId: string): SubjectItem[] {
  const sem = getSemesterById(semesterId);
  return sem ? sem.subjects : [];
}

export function getSubject(semesterId: string, subjectTitle: string): SubjectItem | undefined {
  const subjects = getSubjectsForSemester(semesterId);
  const q = subjectTitle.trim().toLowerCase();
  return subjects.find(s => s.title.toLowerCase() === q || s.code.toLowerCase() === q);
}

export function getChaptersForSubject(semesterId: string, subjectTitle: string): ChapterItem[] {
  const sub = getSubject(semesterId, subjectTitle);
  return sub ? sub.chapters : [];
}

export function findSubjectAcrossSemesters(query: string): { semester: SemesterItem; subject: SubjectItem } | undefined {
  const q = query.trim().toLowerCase();
  for (const sem of SEMESTERS) {
    const sub = sem.subjects.find(s => s.title.toLowerCase() === q || s.code.toLowerCase() === q || s.title.toLowerCase().includes(q));
    if (sub) return { semester: sem, subject: sub };
  }
  return undefined;
}

