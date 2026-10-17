import { SyllabusSemester } from './syllabusTypes';

export const SEMESTERS_PART_4: SyllabusSemester[] = [
  {
    id: 'sem-7',
    semesterNumber: 7,
    semesterRoman: 'VII',
    year: 'Year 4',
    yearNumber: 4,
    title: 'Year 4 · Semester VII',
    shortTitle: 'Semester VII',
    totalCredits: 18,
    totalCourses: 6,
    description: 'Data mining & warehousing, DevOps CI/CD & containerization, technology entrepreneurship, cloud computing & virtualization, wireless communication systems, and Elective I.',
    courses: [
      {
        code: 'CIT411',
        title: 'Data Mining and Warehousing',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH + PR',
        totalHours: '45 hrs',
        year: 'Year 4',
        semester: 'VII',
        objectives: [
          'Provide a broad overview of data mining and data warehousing concepts, ETL pipelines, OLAP multidimensional modeling, classification, association rule mining, clustering, and anomaly detection.',
        ],
        outcomes: [
          'Apply data cleaning, integration, PCA reduction, and discretization preprocessing techniques.',
          'Design multidimensional Data Warehouse schemas (Star, Snowflake, Fact Constellation) and OLAP cubes.',
          'Implement classification (Decision Trees, Naive Bayes, KNN, Random Forest), association mining (Apriori, FP-Growth), clustering (K-Means, Hierarchical, DBSCAN), and outlier detection.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Introduction to Data Mining',
            hours: '5 hrs',
            topics: [
              '1.1 Introduction and Origins of Data Mining',
              '1.2 Data Mining Tasks, Data and Patterns',
              '1.3 Technologies Used and Major Issues in Data Mining',
            ],
          },
          {
            unitNumber: 2,
            title: 'Data Preprocessing',
            hours: '7 hrs',
            topics: [
              '2.1 Data Objects and Attribute Types, Basic Statistical Descriptions of Data',
              '2.2 Data Cleaning and Data Integration',
              '2.3 Data Reduction: Principal Component Analysis (PCA)',
              '2.4 Data Transformation, Discretization, and Measures of Similarity and Dissimilarity',
            ],
          },
          {
            unitNumber: 3,
            title: 'Data Warehousing and Online Analytical Processing (OLAP)',
            hours: '7 hrs',
            topics: [
              '3.1 Data Warehouse Basic Concepts, Features, and Characteristics',
              '3.2 Extract, Transform, and Load (ETL) & Multitiered Architecture',
              '3.3 Conceptual Modeling of Data Warehouses',
              '3.4 Data Cube, Data Mart, and OLAP Operations',
            ],
          },
          {
            unitNumber: 4,
            title: 'Classification',
            hours: '10 hrs',
            topics: [
              '4.1 General Approach to Classification, 4.2 Decision Tree Induction, 4.3 Rule-Based Classifiers',
              '4.4 Nearest-Neighbor (k-NN) Classifiers, 4.5 Naive Bayes Classifier, 4.6 Ensemble Methods: Random Forest',
              '4.7 Model Evaluation: Confusion Matrix, Accuracy, Recall, Precision, and F1-Score',
            ],
          },
          {
            unitNumber: 5,
            title: 'Association Analysis',
            hours: '5 hrs',
            topics: [
              '5.1 Frequent Itemsets and Association Rules (Support, Confidence)',
              '5.2 Apriori Algorithm and 5.3 FP-Growth Algorithm',
            ],
          },
          {
            unitNumber: 6,
            title: 'Cluster Analysis',
            hours: '6 hrs',
            topics: [
              '6.1 Basic Clustering Methods, 6.2 K-Means Clustering, 6.3 Hierarchical Clustering, 6.4 DBSCAN Density-Based Clustering',
            ],
          },
          {
            unitNumber: 7,
            title: 'Anomaly Detection',
            hours: '5 hrs',
            topics: [
              '7.1 Introduction and Issues in Anomaly Detection',
              '7.2 Statistical Approaches to Anomaly Detection: Normal Distribution and Box Plot',
            ],
          },
        ],
        laboratoryWork: [
          'Practical implementation of data preprocessing, OLAP, classification, association rule mining, clustering, and anomaly detection on real-world datasets (e.g., Iris, Wiki) using Python, WEKA, or MATLAB.',
        ],
        references: [
          'Jiawei Han, Micheline Kamber, and Jian Pei, "Data Mining: Concepts and Techniques", Morgan Kaufmann / Elsevier.',
          'Pang-Ning Tan, Michael Steinbach, and Vipin Kumar, "Introduction to Data Mining", Pearson.',
          'Mark W. Humphries, Michael W. Hawkins, and Michelle C. Dy, "Data Warehousing: Architecture and Implementation", Prentice Hall.',
          'Paulraj Ponniah, "Data Warehousing Fundamentals", Wiley.',
        ],
      },
      {
        code: 'CIT412',
        title: 'Software Development and Operations (DevOps)',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH + PR',
        totalHours: '45 hrs',
        year: 'Year 4',
        semester: 'VII',
        objectives: [
          'Understand how modern DevOps processes, automation, CI/CD pipelines, Linux/Bash scripting, Git, Jenkins, Docker, Kubernetes, Ansible, and AWS cloud infrastructure work together.',
        ],
        outcomes: [
          'Understand fundamental DevOps principles and culture for software development and deployment.',
          'Apply Continuous Integration and Continuous Delivery (CI/CD), containerization (Docker/Kubernetes), and configuration management (Ansible) to automate build, test, and deployment pipelines.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Introduction',
            hours: '3 hrs',
            topics: [
              '1.1 DevOps Definition, Scope, and Application',
              '1.2 Introduction to Continuous Integration (CI) and Continuous Delivery (CD)',
              '1.3 Prerequisites and Environment Setup: Chocolatey (Windows), Homebrew (macOS), AWS Setup, Linux Server Management',
              '1.4 Basics of Networking for DevOps',
            ],
          },
          {
            unitNumber: 2,
            title: 'DevOps Basics with Virtualization',
            hours: '5 hrs',
            topics: [
              '2.1 Basics, Types, and Hierarchy of Virtualization',
              '2.2 Manual and Automated Virtualization across Linux, macOS, and Windows',
              '2.3 Bash Scripting Fundamentals: Variables, Conditions, Loops, Automating Day-to-Day Admin Tasks',
            ],
          },
          {
            unitNumber: 3,
            title: 'DevOps on Cloud',
            hours: '6 hrs',
            topics: [
              '3.1 Essentials of Cloud Computing, Cloud & Virtualization Architecture, Cloud Deployment Models',
              '3.2 Overview of Cloud Providers & DevOps on Amazon Web Services (AWS)',
            ],
          },
          {
            unitNumber: 4,
            title: 'Git — A Version Controlling Tool',
            hours: '6 hrs',
            topics: [
              '4.1 Version Control Systems & Git CLI Essentials in Industry',
              '4.2 Tracking, Monitoring, Ignoring, Staging, Merging, Working with Remotes, and Git Workflows',
            ],
          },
          {
            unitNumber: 5,
            title: 'Jenkins',
            hours: '5 hrs',
            topics: [
              '5.1 Essentials of Continuous Integration & Architecture of Jenkins',
              '5.2 Jenkins Tool & User Management, Authentication and Authorization, Maven Overview',
              '5.3 Creating Automated Build Jobs, Delivery Pipelines, Plugin Management, and Notification Systems',
            ],
          },
          {
            unitNumber: 6,
            title: 'Docker',
            hours: '8 hrs',
            topics: [
              '6.1 Containerization Concepts and Docker Architecture',
              '6.2 Docker Containers: Creation, Sharing, and Publishing Images',
              '6.3 Docker Networking and Docker Compose',
              '6.4 Docker Swarm: Creating and Scaling Container Bundles',
            ],
          },
          {
            unitNumber: 7,
            title: 'Kubernetes',
            hours: '4 hrs',
            topics: [
              '7.1 Kubernetes Cluster Architecture',
              '7.2 Pods, ReplicaSets, Deployments, Namespaces, Services, and Networking',
              '7.3 Persistent Volumes (PV) and Persistent Volume Claims (PVC), Labels, Selectors, Jobs, and Schedulers',
            ],
          },
          {
            unitNumber: 8,
            title: 'Ansible',
            hours: '8 hrs',
            topics: [
              '8.1 Ansible Architecture, Control Machine and Managed Node Requirements',
              '8.2 Inventory (Hosts & Groups), Ansible Modules, Ad-hoc Commands, YAML Scripts',
              '8.3 Playbooks: Handlers, Variables, Tasks, Privilege Escalation',
              '8.4 Roles, Directory Structure, Dependencies, Ansible Galaxy, Including and Importing Playbooks',
            ],
          },
        ],
        laboratoryWork: [
          'Hands-on setup of Linux VMs, Bash automation scripts, Git branching workflows, Jenkins CI/CD pipelines with Maven, Dockerized multi-container apps (Docker Compose), Kubernetes Pod/Deployment orchestration, and Ansible infrastructure-as-code playbooks.',
          'Case studies on web deployment architectures, search engine infrastructure, and production automation.',
        ],
        textbooks: [
          'Gene Kim, Jez Humble, Patrick Debois, and John Willis (2021), "The DevOps Handbook: How to Create World-Class Agility, Reliability, and Security in Technology Organizations".',
          'Gene Kim, Kevin Behr, and George Spafford (2018), "The Phoenix Project: A Novel About IT, DevOps, and Helping Your Business Win".',
        ],
        references: [
          'Jennifer Davis and Ryn Daniels (2016), "Effective DevOps: Building a Culture of Collaboration, Affinity, and Tooling at Scale", O’Reilly.',
          'Jez Humble and David Farley (2010), "Continuous Delivery: Reliable Software Releases through Build, Test, and Deployment Automation", Addison-Wesley.',
        ],
      },
      {
        code: 'BCT411',
        title: 'Technology Entrepreneurship',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH',
        totalHours: '45 hrs',
        year: 'Year 4',
        semester: 'VII',
        objectives: [
          'Equip students with entrepreneurial concepts, Lean Startup methodologies, IT business model design, product marketing, intellectual property protection, pitching, fundraising, and venture scaling.',
        ],
        outcomes: [
          'Identify and validate technology startup opportunities through market research and customer development.',
          'Develop sustainable IT business models, MVPs, financial projections, and investor pitch decks.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Introduction to Technology Entrepreneurship',
            hours: '4 hrs',
            topics: [
              'Definition and Types of Entrepreneurs, Fundamentals and Characteristics of Technology Entrepreneurship, Technology-Based Firms',
            ],
          },
          {
            unitNumber: 2,
            title: 'Technology Entrepreneur Development',
            hours: '4 hrs',
            topics: ['Technological Entrepreneurship and Economic Development, Role of Tech Enterprises'],
          },
          {
            unitNumber: 3,
            title: 'Opportunity Identification and Analysis',
            hours: '4 hrs',
            topics: ['Opportunity identification, conducting market research, evaluating emerging business ideas'],
          },
          {
            unitNumber: 4,
            title: 'Development of IT Business Plan and Modeling',
            hours: '3 hrs',
            topics: ['Business Model Canvas, revenue models, and creating a sustainable IT business model'],
          },
          {
            unitNumber: 5,
            title: 'Lean Startup in Software Development',
            hours: '5 hrs',
            topics: ['Lean Startup methodology, Minimum Viable Product (MVP), rapid prototyping, and customer development'],
          },
          {
            unitNumber: 6,
            title: 'IT Product Development, Marketing and Financial Management',
            hours: '8 hrs',
            topics: [
              'Product design, development, testing, and validation; Marketing strategies, branding, and sales; Basics of startup financial statements and budgets',
            ],
          },
          {
            unitNumber: 7,
            title: 'Technology Intellectual Property, Legal and Regulatory Issues',
            hours: '7 hrs',
            topics: [
              'Protection of Intellectual Property (Trademarks, Copyrights, Patents), Corporate formation, Contracts, and Startup legal/regulatory compliance',
            ],
          },
          {
            unitNumber: 8,
            title: 'Pitching and Fundraising',
            hours: '4 hrs',
            topics: ['Building an investor pitch deck, raising seed/venture capital, and the fundraising process'],
          },
          {
            unitNumber: 9,
            title: 'Scaling and Growth',
            hours: '3 hrs',
            topics: ['Approaches for scaling a technology business, team hiring, and strategic partnerships'],
          },
          {
            unitNumber: 10,
            title: 'Technology Entrepreneurial Mindset',
            hours: '3 hrs',
            topics: ['Developing leadership, resilience, and the entrepreneurial mindset'],
          },
        ],
        laboratoryWork: ['All students are required to conduct and present a comprehensive technology startup case study / business plan.'],
        references: [
          'Bruce R. Barringer and R. Duane Ireland, "Entrepreneurship: Successfully Launching New Ventures", Pearson Education.',
          'Richard Blundell and Nigel Lockett, "Exploring Entrepreneurship: Practices and Perspectives", Oxford University Press.',
          'Donald F. Kuratko and T.V. Rao, "Entrepreneurship: A South-Asian Perspective", Cengage Learning.',
          'Richard C. Dorf and Thomas H. Byers, "Technology Ventures: From Idea to Enterprise", McGraw-Hill.',
        ],
      },
      {
        code: 'CIT413',
        title: 'Cloud Computing',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH + PR',
        totalHours: '44 hrs',
        year: 'Year 4',
        semester: 'VII',
        objectives: [
          'Provide theoretical and practical foundations of Cloud Computing, service/deployment models (IaaS, PaaS, SaaS), virtualization, service-oriented/microservices architectures, cloud storage, and resource management.',
        ],
        outcomes: [
          'Explain cloud computing paradigms, service models, and deployment architectures.',
          'Design and manage virtualized infrastructure, microservices, cloud storage, load balancing, and SLAs.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Introduction to Cloud Computing',
            hours: '5 hrs',
            topics: [
              '1.1 Evolution and 1.2 Characteristics of Cloud Computing',
              '1.3 Benefits and challenges of cloud computing',
              '1.4 Cloud Storage, Cloud service requirements, and Cloud adoption',
            ],
          },
          {
            unitNumber: 2,
            title: 'Cloud Service and Deployment Models',
            hours: '10 hrs',
            topics: [
              '2.1 Cloud Computing Service Models: Platform as a Service (PaaS), Software as a Service (SaaS), Infrastructure as a Service (IaaS)',
              '2.2 Cloud Deployment Models: Public Clouds, Private Clouds, Community Clouds, Hybrid Clouds',
            ],
          },
          {
            unitNumber: 3,
            title: 'Cloud Virtualization Technology',
            hours: '6 hrs',
            topics: [
              '3.1 Introduction to Virtualization & 3.2 Levels of Virtualization (Desktop, Hardware, Storage, Application, and OS)',
              '3.3 Benefits of Virtualization, 3.4 Virtualization Software, 3.5 Hypervisors and Types, 3.6 Overview of Kubernetes',
            ],
          },
          {
            unitNumber: 4,
            title: 'Service-Oriented Computing',
            hours: '10 hrs',
            topics: [
              '4.1 Monolithic Architecture vs. Distributed Services',
              '4.2 Service-Oriented Architecture (SOA), Web/SOAP & REST Services, and Microservices Architecture',
            ],
          },
          {
            unitNumber: 5,
            title: 'Storage in Cloud Computing',
            hours: '6 hrs',
            topics: [
              '5.1 Database as a Service (DBaaS) and Cloud Storage Services',
              '5.2 File Storage, 5.3 Block Storage, 5.4 Archive Storage, 5.5 Object Storage',
              '5.6 Cloud Databases: Relational and Non-Relational (NoSQL)',
            ],
          },
          {
            unitNumber: 6,
            title: 'Resource Management in Cloud Computing',
            hours: '7 hrs',
            topics: [
              '6.1 Scaling and its types (Horizontal vs. Vertical Scaling / Auto-scaling)',
              '6.2 Load Balancing, Redundancy, and High Availability',
              '6.3 Cloud Monitoring: Service Level Agreements (SLA), Billing, and Cloud Security',
            ],
          },
        ],
        laboratoryWork: [
          'Hands-on cloud laboratory exercises covering each chapter: provisioning cloud VMs, hypervisors/containers, deploying SOA/microservices, configuring Object/Block/DBaaS storage, and setting up load balancing and auto-scaling.',
        ],
        references: [
          'Rajkumar Buyya, Christian Vecchiola, and S. Thamarai Selvi, "Mastering Cloud Computing", McGraw-Hill / Morgan Kaufmann.',
          'Arshdeep Bahga and Vijay Madisetti, "Cloud Computing: A Hands-On Approach", Universities Press.',
        ],
      },
      {
        code: 'CIT414',
        title: 'Wireless Communication Systems',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH + PR',
        totalHours: '45 hrs',
        year: 'Year 4',
        semester: 'VII',
        objectives: [
          'Provide fundamental understanding of wireless communication principles, cellular network geometry, digital modulation, multiple access techniques (FDMA, TDMA, CDMA, SDMA), radio propagation models, GSM architecture, and 4G/5G/MIMO/NOMA trends.',
        ],
        outcomes: [
          'Analyze cellular frequency reuse, handoff, link budgets, path loss, and multipath fading channels.',
          'Explain GSM architecture, CDMA/LTE operations, and next-generation 5G wireless technologies.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Introduction',
            hours: '6 hrs',
            topics: [
              'Definition and History of Wireless Communication, Simplex/Half-Duplex/Full-Duplex modes, TDD and FDD, Wireless Radio Frequency Spectrum, Evolution of Mobile Communication (1G to 5G+)',
            ],
          },
          {
            unitNumber: 2,
            title: 'Fundamentals of Cellular Mobile Communication',
            hours: '6 hrs',
            topics: [
              'Cellular mobile system concept, Hexagonal cell geometry, Frequency reuse and channel assignment strategies, Handoff strategies, Coverage and capacity enhancement (Cell splitting, Sectoring), Co-channel and Adjacent-channel interference',
            ],
          },
          {
            unitNumber: 3,
            title: 'Modulation and Multiple Access Techniques',
            hours: '10 hrs',
            topics: [
              'Analog Modulation (AM, FM, PM) and Digital Modulation: ASK, FSK, PSK, PCM, DPSK, QPSK, MSK, Gaussian MSK (GMSK)',
              'Multiple Access Techniques: FDMA, TDMA, CDMA, and SDMA',
            ],
          },
          {
            unitNumber: 4,
            title: 'Radio Wave Propagation and Propagation Loss in Mobile Networks',
            hours: '10 hrs',
            topics: [
              'Large-scale path loss, Reflection, Diffraction, Scattering; Link budget design using Indoor (Partition loss, Log-distance) and Outdoor Propagation Models (Okumura, Hata, Longley-Rice)',
              'Mobile Multipath Channel parameters (Time dispersion, Coherence bandwidth, Doppler spread, Coherence time); Small-scale fading (Flat, Frequency-selective, Fast, Slow, Rayleigh and Rician distributions)',
            ],
          },
          {
            unitNumber: 5,
            title: 'Global System for Mobile Communication (GSM)',
            hours: '5 hrs',
            topics: [
              'GSM System Architecture, Radio sub-system, Services and features, Traffic and Control Channels, Frame structure, Frequency hopping, MSC, Call Handover, Authentication and Encryption',
            ],
          },
          {
            unitNumber: 6,
            title: 'Recent Trends in Wireless Communication',
            hours: '8 hrs',
            topics: ['LTE, Evolution beyond 5G, MIMO (Multiple-Input Multiple-Output), and NOMA (Non-Orthogonal Multiple Access)'],
          },
        ],
        laboratoryWork: [
          '1. Study of AM/FM Modulation and Demodulation Systems.',
          '2. Study of Pulse Code Modulation (PCM) System.',
          '3. Study of Digital Carrier Modulation (ASK, FSK, PSK).',
          '4. Study of Eye Diagram for digital baseband transmission.',
          '5. Telecom Field Visit and Technical Report.',
        ],
        references: [
          'Theodore S. Rappaport, "Wireless Communications: Principles and Practice", Prentice Hall.',
          'Simon Haykin, "Digital Communication Systems", Wiley.',
          'B.P. Lathi, "Modern Digital and Analog Communication Systems", Oxford University Press.',
        ],
      },
      {
        code: 'ELE-I',
        title: 'Elective I',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH + PR',
        totalHours: '45 hrs',
        year: 'Year 4',
        semester: 'VII',
        isElectiveSlot: true,
        objectives: [
          'Select one 3-credit specialization course from the 5 approved BIT Elective Clusters (Good Governance, Machine Learning & Data Science, Network & Internet, Software Development, or Geographic Information System).',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Specialization Track Selection (Elective I)',
            topics: [
              'Cluster 1 (Good Governance): E-Governance, E-Business and E-Commerce, Corporate Governance',
              'Cluster 2 (Machine Learning & Data Science): Data Science, Social Media Mining, Machine Learning',
              'Cluster 3 (Network & Internet): Mobile Ad Hoc Network, IPV6 Networking, IOT and Smart Technologies',
              'Cluster 4 (Software Development): Visual Programming, Agile Software Development, Software Quality Assurance',
              'Cluster 5 (Geographic Information System): Remote Sensing, Geographic Information System (GIS), Geo Spatial Data Processing and Management',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'sem-8',
    semesterNumber: 8,
    semesterRoman: 'VIII',
    year: 'Year 4',
    yearNumber: 4,
    title: 'Year 4 · Semester VIII',
    shortTitle: 'Semester VIII',
    totalCredits: 17,
    totalCourses: 5,
    description: 'Big data technologies & Hadoop ecosystem, society/IT & cyber law in Nepal, industry internship, Elective II, and major capstone Project IV.',
    courses: [
      {
        code: 'CIT421',
        title: 'Big Data Technologies',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH + PR',
        totalHours: '45 hrs',
        year: 'Year 4',
        semester: 'VIII',
        objectives: [
          'Understand Big Data platforms, Google File System (GFS), MapReduce, Apache Hadoop & HDFS, the Hadoop Ecosystem (Pig, Hive, HBase, Spark), and full-text distributed search/indexing (Lucene, Solr, Elasticsearch).',
        ],
        outcomes: [
          'Store, ingest, and process large-scale structured and unstructured datasets across HDFS and MapReduce.',
          'Build big data pipelines and distributed search indices using Pig, Hive, HBase, Spark, Apache Solr, and Elasticsearch.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Introduction to Big Data and Hadoop',
            hours: '8 hrs',
            topics: [
              'Types of Digital Data (Structured, Semi-Structured, Unstructured), Big Data Analytics, Role of Distributed Systems in Big Data, Current Trends, Introduction to NoSQL Databases',
            ],
          },
          {
            unitNumber: 2,
            title: 'Google File System (GFS) and MapReduce Framework',
            hours: '10 hrs',
            topics: [
              'GFS Architecture, Read/Write/Append algorithms, and Fault Tolerance',
              'MapReduce: Anatomy of a MapReduce Job Run, Architecture, Fault Tolerance, Job Scheduling, Shuffle and Sort, Task Execution, Parallel Efficiency, and Features',
            ],
          },
          {
            unitNumber: 3,
            title: 'Apache Hadoop and HDFS (Hadoop Distributed File System)',
            hours: '10 hrs',
            topics: [
              'History of Hadoop, Analyzing Data with Unix Tools vs. Hadoop, Hadoop Streaming, Hadoop Ecosystem',
              'HDFS Design, Concepts, CLI, File System Interfaces, Data Flow, Data Ingest with Flume and Sqoop, Hadoop Archives',
              'Hadoop I/O: Compression, Serialization (Avro), and File-Based Data Structures',
            ],
          },
          {
            unitNumber: 4,
            title: 'Hadoop Ecosystem',
            hours: '10 hrs',
            topics: [
              'Apache Pig: Execution Modes, Grunt, Pig Latin, User-Defined Functions (UDFs), Data Processing Operators',
              'Apache Hive: Hive Shell, Hive Services, Metastore, HiveQL, Tables, Querying Data, and UDFs',
              'Apache HBase: Architecture, Concepts, Clients, HBase vs. RDBMS',
              'Apache Spark: Introduction and Core Concepts (RDDs / DataFrames)',
            ],
          },
          {
            unitNumber: 5,
            title: 'Searching and Indexing',
            hours: '7 hrs',
            topics: [
              'Full-Text Indexing and Searching with Apache Lucene, Introduction to Apache Solr, Distributed Search and CRUD Indexing with Elasticsearch',
            ],
          },
        ],
        laboratoryWork: [
          '1. Install Apache Hadoop and configure HDFS (single-node and multi-node cluster) and perform HDFS file operations.',
          '2. Write and execute MapReduce programs on Apache Hadoop.',
          '3. Configure HBase in standalone and distributed modes and write data ingestion/query programs.',
          '4. Set up Elasticsearch, define index templates, index documents, and run distributed queries.',
          '5. Set up Apache Solr, define schemas, index data, and execute full-text search queries.',
        ],
        textbooks: [
          'Tom White, "Hadoop: The Definitive Guide", 3rd/4th Edition, O’Reilly Media.',
          'Seema Acharya and Subhashini Chellappan, "Big Data and Analytics", Wiley.',
        ],
        references: [
          'Jay Liebowitz, "Big Data and Business Analytics", Auerbach / CRC Press, 2013.',
          'Pete Warden, "Big Data Glossary", O’Reilly, 2011.',
          'Michael Minelli, Michele Chambers, and Ambiga Dhiraj, "Big Data, Big Analytics", Wiley, 2013.',
          'Jeffrey Dean and Sanjay Ghemawat, "MapReduce: Simplified Data Processing on Large Clusters", OSDI 2004.',
        ],
      },
      {
        code: 'BCT421',
        title: 'Society, IT and Law',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH',
        totalHours: '45 hrs',
        year: 'Year 4',
        semester: 'VIII',
        objectives: [
          'Provide students with a thorough understanding of the relationship among Society, Information Technology, and Law, focusing on ethical issues, intellectual property, cybercrime, e-commerce consumer protection, and the Nepalese legal framework.',
        ],
        outcomes: [
          'Analyze ethical, privacy, and social implications of IT and social media.',
          'Apply Nepalese and international cyber law, intellectual property law, and e-commerce consumer protection frameworks to real-world legal case studies.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Introduction to Society, IT, and Law',
            hours: '3 hrs',
            topics: [
              '1.1 Course objectives and scope (1 hr)',
              '1.2 Definition and scope of Society, IT, and Law (1 hr)',
              '1.3 Interactions and relationships among Society, IT, and Law (1 hr)',
            ],
          },
          {
            unitNumber: 2,
            title: 'Ethical and Social Implications of IT',
            hours: '6 hrs',
            topics: [
              '2.1 Ethical considerations in IT and their impact on society (2 hrs)',
              '2.2 Social implications of IT, including privacy and security concerns (2 hrs)',
              '2.3 Legal frameworks and guidelines for addressing ethical and social issues in IT (2 hrs)',
            ],
          },
          {
            unitNumber: 3,
            title: 'Intellectual Property Law',
            hours: '9 hrs',
            topics: [
              '3.1 Overview of Intellectual Property Law (3 hrs)',
              '3.2 Copyright, Trademark, and Patent Law (3 hrs)',
              '3.3 Protection of Intellectual Property in the Digital Age (3 hrs)',
              'Case Studies: (a) Apple vs. Samsung smartphone patent dispute; (b) Nepal Music Copyright Society (NMC) 2019 royalty dispute',
            ],
          },
          {
            unitNumber: 4,
            title: 'Cybercrime and Cybersecurity Law',
            hours: '9 hrs',
            topics: [
              '4.1 Overview of Cybercrime and Cybersecurity Law (3 hrs)',
              '4.2 Types of Cybercrime, including Hacking and Identity Theft (3 hrs)',
              '4.3 Legal and technological measures for preventing and responding to cybercrime (3 hrs)',
              'Case Study: Nepal Rastra Bank (NRB) 2020 data breach and national cybersecurity readiness',
            ],
          },
          {
            unitNumber: 5,
            title: 'E-Commerce and Consumer Protection Law',
            hours: '9 hrs',
            topics: [
              '5.1 Overview of E-Commerce and Consumer Protection Law (3 hrs)',
              '5.2 Legal frameworks and guidelines for online transactions (3 hrs)',
              '5.3 Protection of consumer rights in E-Commerce (3 hrs)',
              'Case Study: Daraz Nepal 2021 refund policy controversy and e-commerce consumer rights in Nepal',
            ],
          },
          {
            unitNumber: 6,
            title: 'International and Comparative Law',
            hours: '6 hrs',
            topics: [
              '6.1 Overview of International and Comparative IT Law (2 hrs)',
              '6.2 Differences and similarities among global legal systems (2 hrs)',
              '6.3 Role of international law in governing IT and society (2 hrs)',
            ],
          },
          {
            unitNumber: 7,
            title: 'Emerging Issues in Society, IT, and Law',
            hours: '3 hrs',
            topics: [
              '7.1 Review of current and emerging issues in AI, data governance, and digital rights (2 hrs)',
              '7.2 Future legal developments and their implications (1 hr)',
            ],
          },
        ],
        references: [
          'Andrew Murray, "Information Technology Law: The Law and Society", Oxford University Press.',
          'Lionel Bently and Brad Sherman, "Intellectual Property Law", Oxford University Press.',
          'Julia Hörnle and Christian Twigg-Flesner, "E-Commerce Law: National and Transnational Topics and Perspectives".',
          'Nandan Kamath, "Law Relating to Computers, Internet and E-Commerce: A Guide to Cyberlaws", Universal Law Publishing.',
        ],
      },
      {
        code: 'CIT422',
        title: 'Internship',
        credit: 2,
        creditDisplay: '2',
        nature: 'PR',
        totalHours: '30 hrs',
        year: 'Year 4',
        semester: 'VIII',
        objectives: [
          'Bridge academic theory and industry practice through supervised hands-on work in a software/IT organization, adhering to workplace ethics, maintaining a signed reflective logbook, and delivering an internship report and reflection article/video.',
        ],
        outcomes: [
          'Gain practical industry experience in software development, database administration, networking, or cybersecurity.',
          'Enhance professional communication, code review, quality assurance, and project execution skills in Nepal’s IT sector.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Introduction to Internship',
            hours: '3 hrs',
            topics: [
              '1.1 Program orientation and internship guidelines, 1.2 Familiarization with host organization IT infrastructure, 1.3 IT department roles and responsibilities, 1.4 Defining internship goals and learning objectives',
            ],
          },
          {
            unitNumber: 2,
            title: 'Understanding the Organization',
            hours: '6 hrs',
            topics: [
              '2.1 Shadowing IT professionals across software development, networking, and security; 2.2 Assisting with routine IT operations; 2.3 IT project management methodologies; 2.4 Documentation and reporting practices',
            ],
          },
          {
            unitNumber: 3,
            title: 'Collaborating in a Project',
            hours: '9 hrs',
            topics: [
              '3.1 Collaborating with the IT team on ongoing production projects, 3.2 Programming languages and frameworks, 3.3 Network configuration/administration, 3.4 Database optimization, 3.5 Cybersecurity and risk management',
            ],
          },
          {
            unitNumber: 4,
            title: 'Undertaking Own Project',
            hours: '9 hrs',
            topics: [
              '4.1 Undertaking an independent module/project aligned with organization needs, 4.2 Implementing software/web solutions, 4.3 Researching emerging tech, 4.4 Code reviews and QA testing, 4.5 Project execution',
            ],
          },
          {
            unitNumber: 5,
            title: 'Reporting & Reflection',
            hours: '3 hrs',
            topics: [
              '5.1 Finalizing and presenting the internship project, 5.2 Outcome analysis, 5.3 Maintaining a supervisor-signed log report, 5.4 Creating a reflective video/text article, 5.5 Evaluation and Certificate of Completion',
            ],
          },
        ],
      },
      {
        code: 'ELE-II',
        title: 'Elective II',
        credit: 3,
        creditDisplay: '3',
        nature: 'TH + PR',
        totalHours: '45 hrs',
        year: 'Year 4',
        semester: 'VIII',
        isElectiveSlot: true,
        objectives: [
          'Select a second 3-credit advanced specialization course from the 5 approved BIT Elective Clusters.',
        ],
        units: [
          {
            unitNumber: 1,
            title: 'Specialization Track Selection (Elective II)',
            topics: [
              'Cluster 1 (Good Governance): E-Governance, E-Business and E-Commerce, Corporate Governance',
              'Cluster 2 (Machine Learning & Data Science): Data Science, Social Media Mining, Machine Learning',
              'Cluster 3 (Network & Internet): Mobile Ad Hoc Network, IPV6 Networking, IOT and Smart Technologies',
              'Cluster 4 (Software Development): Visual Programming, Agile Software Development, Software Quality Assurance',
              'Cluster 5 (Geographic Information System): Remote Sensing, Geographic Information System (GIS), Geo Spatial Data Processing and Management',
            ],
          },
        ],
      },
      {
        code: 'CIT423',
        title: 'Project IV',
        credit: 6,
        creditDisplay: '6',
        nature: 'PR',
        year: 'Year 4',
        semester: 'VIII',
        objectives: [
          'Synthesize comprehensive knowledge acquired across the entire BIT degree to architect, implement, test, document, and defend a real-world production-grade application or system software.',
        ],
        description:
          'Major 6-credit final-year capstone project where students (in groups of at most 3 members) implement custom program modules, algorithms, and system architectures rather than relying solely on predefined APIs.',
        units: [
          {
            unitNumber: 1,
            title: 'Phase 1: Proposal Submission and Presentation',
            topics: [
              'Submit and defend the formal project proposal covering Introduction, Problem Statement, Objectives, Methodology, Schedule, Expected Outcome, and References.',
            ],
          },
          {
            unitNumber: 2,
            title: 'Phase 2: Mid-Term Progress Defense',
            topics: [
              'Submit the midterm progress report and defend system architecture, core algorithm implementation, and progress by mid-semester.',
            ],
          },
          {
            unitNumber: 3,
            title: 'Phase 3: Final Submission & Board Examination Defense',
            topics: [
              'Submit the bound hard/soft copy report in standard Gandaki University format at least one week before the final presentation, and defend before the Evaluation Committee and External Examiner.',
            ],
          },
        ],
        projectGuidelines: {
          phases: [
            {
              title: '1. Proposal Submission and Presentation',
              description: 'Students submit and present a project proposal in the prescribed format.',
            },
            {
              title: '2. Mid-Term Progress Defense',
              description: 'Students submit a progress report and defend midterm progress by the middle of the semester.',
            },
            {
              title: '3. Final Submission & External Defense',
              description:
                'Students submit hard/soft copies of the final report one week prior to the final presentation and defend before the Evaluation Committee and External Examiner.',
            },
          ],
          documentItems: [
            'Proposal Flow: (a) Introduction, (b) Problem Statement, (c) Objectives, (d) Methodology, (e) Schedule, (f) Expected Outcome, (g) References',
            'Final Report Flow: (a) Cover & Title Page, (b) Certificate Page, (c) Acknowledgement, (d) Abstract Page, (e) Table of Contents, (f) List of Abbreviations, Figures & Tables, (g) Main Report, (h) References, (i) Bibliography, (j) Appendices',
          ],
          reportFormat: [
            'Paper Size & Margins: A4 paper; Top = 1", Bottom = 1", Left = 1.25", Right = 1"',
            'Pagination: Roman numerals (i, ii, iii...) from Certificate page to List of Tables/Figures; Arabic numerals (1, 2, 3...) from Chapter 1 onwards, centered at bottom',
            'Typography: Times New Roman, 12pt body text, justified paragraphs with 1.5 line spacing',
            'Headings: Boldface — Chapter Headings: 16pt, Section Headings: 14pt, Sub-section Headings: 12pt',
            'Figures & Tables: Center-aligned; Figure captions centered below figures (12pt bold); Table captions centered above tables (12pt bold)',
          ],
        },
      },
    ],
  },
];
