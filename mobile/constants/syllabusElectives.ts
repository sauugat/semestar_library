import { SyllabusCourse } from './syllabusTypes';

export const ELECTIVE_COURSES: SyllabusCourse[] = [
  // ─── CLUSTER 1: GOOD GOVERNANCE ─────────────────────────────────────────
  {
    code: 'ELE',
    title: 'E-Governance',
    credit: 3,
    creditDisplay: '3',
    nature: 'TH + PR',
    totalHours: '45 hrs',
    year: 'Year 4',
    semester: 'VII/VIII',
    cluster: 'Cluster 1: Good Governance',
    objectives: [
      'Familiarize students with E-Governance concepts, digital service delivery models (G2C, G2B, G2G, G2E), national ICT infrastructure, security frameworks, emerging technology integration, and Nepal/SAARC case studies.',
    ],
    outcomes: [
      'Demonstrate theoretical and conceptual grounding in E-Governance and public service delivery.',
      'Analyze E-Readiness, data center/cloud infrastructure, cyber laws, and smart municipality (Smart Nagarpalika) initiatives.',
    ],
    units: [
      {
        unitNumber: 1,
        title: 'Introduction',
        hours: '5 hrs',
        topics: [
          'ICTs and Development, Role of ICT in Public Services, Evolution, Scope and Content of E-Governance, Difference between E-Government and E-Governance, Benefits, Challenges, and Global Trends',
        ],
      },
      {
        unitNumber: 2,
        title: 'Models of E-Governance',
        hours: '10 hrs',
        topics: [
          'Digital Delivery of Public Services: G2C, G2B, G2G, G2E Models',
          'Models of Digital Governance: Broadcasting/Wider Dissemination, Critical Flow, Comparative Analysis, Mobilization and Lobbying, Interactive Service Models; Evolution and Maturity Models',
        ],
      },
      {
        unitNumber: 3,
        title: 'E-Government Infrastructure Development',
        hours: '9 hrs',
        topics: [
          'E-Readiness and Assessments (Legal, Institutional, Human, Technological Preparedness), Network and Computing Infrastructure, Data Centers, E-Government Architecture, Cloud Governance, ICT Penetration Issues',
        ],
      },
      {
        unitNumber: 4,
        title: 'Security for E-Governance',
        hours: '6 hrs',
        topics: [
          'Security Issues and Challenges, Security Frameworks, Security Management Models, E-Government Security Architecture, and Security Standards',
        ],
      },
      {
        unitNumber: 5,
        title: 'Applications of Emerging Technologies on E-Governance',
        hours: '5 hrs',
        topics: [
          'National Data Warehouses (Census, Commodities), Data Mining in Agriculture, Health, Education, Planning, and Commerce; Social Media, Mobile, and Cloud Computing Implications',
        ],
      },
      {
        unitNumber: 6,
        title: 'Case Studies',
        hours: '10 hrs',
        topics: [
          'E-Governance in Nepal (Success Stories), Cyber Laws, IT Policy, Local-Level E-Governance (Smart Nagarpalika)',
          'Regional & International Case Studies: Land Reform, HRM Software, NICNET, CARD, Reservoir Monitoring, Ekal Seva Kendra, Sachivalaya Vahini, Bhoomi, IT in Judiciary, E-Khazana, E-Seva, E-Panchayat, SAARC Region E-Governance',
        ],
      },
    ],
    laboratoryWork: ['Students are required to research, prepare, and present a comprehensive case study on E-Governance.'],
    textbooks: ['C.S.R. Prabhu (2012), "E-Governance: Concepts and Case Studies", 2nd Edition, PHI Learning.'],
    references: [
      'P.K. Suri and Sushil (2019), "Strategic Planning and Implementation of E-Governance", Springer.',
      'Michiel Backus (2001), "E-Governance in Developing Countries", IICD Research Brief No. 1.',
      'Richard Heeks (2006), "Implementing and Managing eGovernment", SAGE Publications.',
    ],
  },
  {
    code: 'ELE',
    title: 'E-Business and E-Commerce',
    credit: 3,
    creditDisplay: '3',
    nature: 'TH + PR',
    totalHours: '45 hrs',
    year: 'Year 4',
    semester: 'VII/VIII',
    cluster: 'Cluster 1: Good Governance',
    objectives: [
      'Provide students with an understanding of e-business and e-commerce models, website/CMS development, digital marketing (SEO, PPC, Social Media), mobile commerce, e-payment systems, security, and CRM.',
    ],
    outcomes: [
      'Design and develop an e-commerce website and mobile commerce prototype with online payment integration.',
      'Execute SEO, PPC, social media marketing, security audits, and customer retention/CRM strategies.',
    ],
    units: [
      {
        unitNumber: 1,
        title: 'Introduction to E-Business and E-Commerce',
        hours: '6 hrs',
        topics: [
          '1.1 What is E-Business and E-Commerce (2 hrs), 1.2 Importance (1 hr), 1.3 Types of E-Commerce: B2B, B2C, C2C, D2C (1 hr), 1.4 E-Commerce vs. Traditional Commerce (2 hrs)',
        ],
      },
      {
        unitNumber: 2,
        title: 'Building an E-Commerce Website',
        hours: '9 hrs',
        topics: [
          '2.1 Website Design and Development (3 hrs), 2.2 Content Management Systems - CMS (2 hrs), 2.3 E-Commerce Platforms (2 hrs), 2.4 Online Payment Systems (2 hrs)',
        ],
      },
      {
        unitNumber: 3,
        title: 'Online Marketing for E-Commerce',
        hours: '9 hrs',
        topics: [
          '3.1 Digital Marketing Channels (2 hrs), 3.2 Search Engine Optimization - SEO (3 hrs), 3.3 Pay-Per-Click - PPC Advertising (2 hrs), 3.4 Social Media Marketing (2 hrs)',
        ],
      },
      {
        unitNumber: 4,
        title: 'Mobile E-Commerce',
        hours: '6 hrs',
        topics: [
          '4.1 Mobile Commerce Platforms (2 hrs), 4.2 Mobile Payment Systems & Digital Wallets (2 hrs), 4.3 Mobile E-Commerce App Development (2 hrs)',
        ],
      },
      {
        unitNumber: 5,
        title: 'Security and Privacy in E-Commerce',
        hours: '6 hrs',
        topics: [
          '5.1 Online Security Threats (2 hrs), 5.2 Security Solutions & SSL/PCI-DSS (2 hrs), 5.3 Privacy Concerns & Data Protection (2 hrs)',
        ],
      },
      {
        unitNumber: 6,
        title: 'Social Media and E-Commerce',
        hours: '6 hrs',
        topics: [
          '6.1 Role of Social Media (2 hrs), 6.2 Social Commerce Strategies (2 hrs), 6.3 Analytics and Conversion Metrics (2 hrs)',
        ],
      },
      {
        unitNumber: 7,
        title: 'Customer Relationship Management in E-Commerce',
        hours: '3 hrs',
        topics: [
          '7.1 CRM Strategies (1 hr), 7.2 Customer Retention and Loyalty Programs (1 hr), 7.3 Personalization Engines (1 hr)',
        ],
      },
    ],
    laboratoryWork: [
      'Design and develop an e-commerce website using a CMS/e-commerce platform with online payment integration.',
      'Create and optimize SEO, PPC, and social media marketing campaigns.',
      'Develop a mobile e-commerce app prototype, conduct security audits, and collaborate on a complete e-commerce business plan.',
    ],
    textbooks: [
      'Kenneth C. Laudon and Carol Guercio Traver, "E-Commerce 2021: Business, Technology, Society", Pearson.',
    ],
    references: [
      'Alan Davidson, "E-Commerce: A Guide to the Law of Electronic Business".',
      'Ryan Deiss, "Social Media Marketing for E-Commerce".',
      'Wen-Chen Hu, "Mobile Commerce: Opportunities, Applications, and Technologies of Wireless Business".',
    ],
  },
  {
    code: 'ELE',
    title: 'Corporate Governance',
    credit: 3,
    creditDisplay: '3',
    nature: 'TH',
    totalHours: '45 hrs',
    year: 'Year 4',
    semester: 'VII/VIII',
    cluster: 'Cluster 1: Good Governance',
    note: 'Designated Cluster 1 Elective in the official BIT Curriculum structure (Page 14).',
    objectives: [
      'Understand corporate governance frameworks, board accountability, stakeholder rights, IT governance (COBIT/ISO 38500), corporate social responsibility (CSR), and regulatory compliance.',
    ],
    units: [
      {
        unitNumber: 1,
        title: 'Foundations of Corporate & IT Governance',
        hours: '45 hrs',
        topics: [
          'Corporate Governance principles, Board structure and fiduciary duties, Shareholder and stakeholder rights',
          'IT Governance frameworks (COBIT, ISO/IEC 38500), Enterprise Risk Management, Internal Audit, Corporate Social Responsibility (CSR), and Regulatory Compliance in Nepal',
        ],
      },
    ],
  },

  // ─── CLUSTER 2: MACHINE LEARNING AND DATA SCIENCE ───────────────────────
  {
    code: 'ELE',
    title: 'Data Science',
    credit: 3,
    creditDisplay: '3',
    nature: 'TH + PR',
    totalHours: '45 hrs',
    year: 'Year 4',
    semester: 'VII/VIII',
    cluster: 'Cluster 2: Machine Learning and Data Science',
    objectives: [
      'Provide a solid foundation in data science principles, statistical inference, data wrangling, exploratory data analysis (EDA), data visualization, and machine learning using Python (NumPy, Pandas, Matplotlib, Seaborn, scikit-learn).',
    ],
    outcomes: [
      'Collect, scrape, clean, wrangle, and preprocess real-world structured and unstructured datasets.',
      'Perform inferential statistical analysis, build predictive models with scikit-learn, and communicate insights through rich visualizations.',
    ],
    units: [
      {
        unitNumber: 1,
        title: 'Introduction to Data Science',
        hours: '6 hrs',
        topics: [
          '1.1 Overview and 1.2 Importance of Data Science, 1.3 Concept of Big Data, 1.4 Skills and Tools required',
          '1.5 Ethical Considerations: Privacy, Security, Bias, Fairness, Transparency, and Accountability',
          '1.6 Applications: Business, Social Media, Healthcare, Environmental Analytics, and Local Use Cases',
        ],
      },
      {
        unitNumber: 2,
        title: 'Statistical Analysis',
        hours: '10 hrs',
        topics: [
          '2.1 Random Sampling and Sample Bias, Sample Mean vs. Population Mean, Mean vs. Median',
          "2.2 Inferential Statistics: Central Limit Theorem, Standard Error, Confidence Intervals, Normal, Student's t, and Binomial Distributions",
          "2.3 Hypothesis Tests & 2.4 Statistical Significance, 2.5 Regression and Multivariate Analysis, 2.6 Time Series Analysis, 2.7 Conditional Probability and Bayes' Theorem",
        ],
      },
      {
        unitNumber: 3,
        title: 'Data Collection and Preprocessing',
        hours: '10 hrs',
        topics: [
          '3.1 Data Sources: Reading Files, Web Scraping, and REST APIs',
          '3.2 Data Cleaning: Handling Missing, Noisy, and Incomplete Data',
          '3.3 Data Wrangling: Join, Combine, and Reshape; 3.4 Data Integration, 3.5 Transformation, 3.6 Categorical Encoding',
        ],
      },
      {
        unitNumber: 4,
        title: 'Data Exploration and Visualization',
        hours: '10 hrs',
        topics: [
          '4.1 Exploratory Data Analysis (EDA): Estimates of Location and Variability, Exploring Data Distributions, Binary and Categorical Data',
          '4.2 Visualization Techniques: Percentiles, Boxplots, Frequency Tables, Histograms, Line Plots, Bar Plots, Density Plots, and Scatter Plots',
        ],
      },
      {
        unitNumber: 5,
        title: 'Introduction to Data Science Tools',
        hours: '9 hrs',
        topics: [
          '5.1 NumPy and Pandas for numerical computing and DataFrame manipulation',
          '5.2 Matplotlib and Seaborn for statistical data visualization',
          '5.3 Machine Learning modeling with scikit-learn',
        ],
      },
    ],
    laboratoryWork: [
      'End-to-end practical exercises using Python (Jupyter, NumPy, Pandas, Matplotlib, Seaborn, scikit-learn) or R on real-world data-intensive problems.',
    ],
    references: [
      'Wes McKinney, "Python for Data Analysis: Data Wrangling with pandas, NumPy, and Jupyter", 3rd Edition, O’Reilly Media, 2022.',
      'Joel Grus, "Data Science from Scratch: First Principles with Python", 2nd Edition, O’Reilly Media, 2019.',
      'Foster Provost and Tom Fawcett, "Data Science for Business", O’Reilly Media, 2013.',
      'Peter Bruce, Andrew Bruce, and Peter Gedeck, "Practical Statistics for Data Scientists", 2nd Edition, O’Reilly Media, 2020.',
      'Cathy O’Neil and Rachel Schutt, "Doing Data Science", O’Reilly Media, 2014.',
    ],
  },
  {
    code: 'ELE',
    title: 'Social Media Mining',
    credit: 3,
    creditDisplay: '3',
    nature: 'TH + PR',
    totalHours: '45 hrs',
    year: 'Year 4',
    semester: 'VII/VIII',
    cluster: 'Cluster 2: Machine Learning and Data Science',
    objectives: [
      'Provide fundamental knowledge and hands-on programming skills in mining social media platforms using graph mining, text/NLP mining, network centrality/influence analysis, network evolution models, and social APIs.',
    ],
    outcomes: [
      'Collect social media data via OAuth and Streaming/REST/Graph APIs.',
      'Apply graph algorithms, centrality measures, link prediction, sentiment analysis, topic modeling, and LLM/word embeddings on social network data.',
    ],
    units: [
      {
        unitNumber: 1,
        title: 'Introduction',
        hours: '5 hrs',
        topics: [
          'Web history and trends, WWW, W3C, Semantic Web, Social Media platforms and Social Networks, Social Media Data as Big Data, Potentials and Pitfalls of Social Media Data',
        ],
      },
      {
        unitNumber: 2,
        title: 'Graph Mining Techniques',
        hours: '10 hrs',
        topics: [
          'Nodes, Degree, Edges, Paths, Cycles, Graph Representations, Connectivity and Traversability',
          'Trees and Forests, Special Subgraphs, Complete, Planar, Bipartite, and Regular Graphs, Bridges',
          'Graph Traversal, Shortest Path Algorithms, Minimum Spanning Trees, Network Flow Algorithms, Maximum Bipartite Matching, Bridge Detection',
        ],
      },
      {
        unitNumber: 3,
        title: 'Text Mining Techniques',
        hours: '10 hrs',
        topics: [
          'Predictive vs. Exploratory Text Analysis, Text Mining Pipeline, Preprocessing, Feature Extraction & Selection, Document Representation',
          'Text Classification & Clustering, N-gram Analysis, Topic Modeling, POS Tagging, Aspect Detection, Named Entity Recognition (NER), Word Embeddings, Large Language Models (LLMs), and Sentiment Analysis',
        ],
      },
      {
        unitNumber: 4,
        title: 'Connectivity, Influence and Centralization',
        hours: '5 hrs',
        topics: [
          'Degree, Closeness, Betweenness, and Eigenvector/PageRank Centrality measures; Applying network centrality to real-world influence analysis',
        ],
      },
      {
        unitNumber: 5,
        title: 'Network Evolution',
        hours: '5 hrs',
        topics: [
          'Characteristics of real-world large networks (Power-law degree distribution, high clustering, small-world property), Preferential Attachment Model, Small-World Model, Link Prediction and evaluation metrics',
        ],
      },
      {
        unitNumber: 6,
        title: 'Case Studies with Twitter/X, Facebook, and TripAdvisor',
        hours: '10 hrs',
        topics: [
          'OAuth and Social Media APIs (Streaming, Search, Social Graph APIs), Trending Topics, Retweet & Follower/Friendship networks, User/Content Similarity, Frequency & Sentiment Analysis, Influential User Identification',
        ],
      },
    ],
    laboratoryWork: [
      'Implement all topics in Unit 6 as practical laboratory work: OAuth API data collection, social graph construction, centrality/influence ranking, topic modeling, and sentiment analysis.',
    ],
    references: [
      'Reza Zafarani, Mohammad Ali Abbasi, and Huan Liu, "Social Media Mining: An Introduction", Cambridge University Press.',
      'Matthew A. Russell, "Mining the Social Web / 21 Recipes for Mining Twitter", O’Reilly Media.',
      'Charu C. Aggarwal, "Social Network Data Analytics", Springer.',
      'Reinhard Diestel, "Graph Theory", 5th Edition, Springer, 2017.',
      'Nathan Danneman and Richard Heimann, "Social Media Mining with R", Packt Publishing.',
    ],
  },
  {
    code: 'ELE',
    title: 'Machine Learning',
    credit: 3,
    creditDisplay: '3',
    nature: 'TH + PR',
    totalHours: '45 hrs',
    year: 'Year 4',
    semester: 'VII/VIII',
    cluster: 'Cluster 2: Machine Learning and Data Science',
    objectives: [
      'Understand core principles and algorithms of Machine Learning, Artificial Neural Networks, Supervised/Unsupervised learning, Ensemble methods, Model Evaluation, and Recommendation Systems.',
    ],
    outcomes: [
      'Train, regularize, and evaluate neural networks, SVMs, Decision Trees, regressions, and clustering models.',
      'Build end-to-end machine learning pipelines and recommendation engines using Scikit-learn, TensorFlow, Keras, and PyTorch.',
    ],
    units: [
      {
        unitNumber: 1,
        title: 'Introduction to Machine Learning',
        hours: '7 hrs',
        topics: [
          '1.1 What and Why ML? 1.2 Supervised, Unsupervised, and Reinforcement Learning, 1.3 ML Applications',
          '1.4 Pattern Recognition Systems, Features, Feature Vectors, Classifiers, Data Augmentation, Training/Test Splits',
          '1.5 Introduction to Deep Learning (DL): AI vs. ML vs. DL',
        ],
      },
      {
        unitNumber: 2,
        title: 'Artificial Neural Networks',
        hours: '10 hrs',
        topics: [
          '2.1 Neural Network Topologies & 2.2 Activation Functions (Sign, Bipolar, Tanh, Sigmoid, SoftMax, ReLU, Leaky ReLU)',
          '2.3 Perceptron and Perceptron Convergence Theorem',
          '2.4 Multilayer Perceptron (MLP) and Backpropagation Algorithm',
          '2.5 Learning Rate, Cost Functions, Batch/Stochastic/Mini-batch Gradient Descent, Delta Rule',
          '2.6 Regularization Techniques: Dropout, L1 (Lasso) and L2 (Ridge) Regularization',
        ],
      },
      {
        unitNumber: 3,
        title: 'Classification and Clustering',
        hours: '10 hrs',
        topics: [
          '3.1 Decision Trees and k-Nearest Neighbors (k-NN)',
          '3.2 Linear Regression and Logistic Regression',
          '3.3 Support Vector Machines (SVM): Hyperplanes, Support Vectors, Linear SVM, Kernel Trick, Multiclass SVM',
          '3.4 Dimensionality Reduction: Principal Component Analysis (PCA)',
          '3.5 Clustering: K-Means and DBSCAN; Cluster Validation (SSE, Silhouette Coefficient, Dunn Index)',
        ],
      },
      {
        unitNumber: 4,
        title: 'Estimating and Measures for Performance Evaluation',
        hours: '10 hrs',
        topics: [
          '4.1 Bias, Variance, Underfitting, and Overfitting',
          '4.2 Cross-Validation and Resampling: Holdout, k-Fold Cross-Validation, Bootstrap',
          '4.3 Ensemble Methods: Bagging, Boosting (AdaBoost, XGBoost), and Random Forest',
          '4.4 Confusion Matrix, Accuracy, Precision, Recall, F1-Score, Sensitivity, Specificity, ROC Curve, and AUC',
        ],
      },
      {
        unitNumber: 5,
        title: 'Introduction to Recommendation Systems',
        hours: '8 hrs',
        topics: [
          '5.1 Overview of Recommendation Systems',
          '5.2 Collaborative Filtering (User-Based and Item-Based), Content-Based Filtering, and Hybrid Recommender Systems',
          '5.3 Evaluation Metrics and Real-World Applications of Recommendation Systems',
        ],
      },
    ],
    laboratoryWork: [
      'Implement classification, regression, clustering, dimensionality reduction, deep neural networks, and recommendation models on real-world datasets using Python, Scikit-learn, TensorFlow, Keras, and PyTorch.',
    ],
    references: [
      'Christopher M. Bishop, "Pattern Recognition and Machine Learning", Springer.',
      'Simon Rogers and Mark Girolami, "A First Course in Machine Learning", Chapman and Hall/CRC.',
      'Kevin P. Murphy, "Machine Learning: A Probabilistic Perspective", MIT Press.',
      'Francesco Ricci, Lior Rokach, and Bracha Shapira (Eds.), "Recommender Systems Handbook", Springer.',
      'Kim Falk, "Practical Recommender Systems", Manning.',
    ],
  },

  // ─── CLUSTER 3: NETWORK AND INTERNET ────────────────────────────────────
  {
    code: 'ELE',
    title: 'Mobile Ad Hoc Network',
    credit: 3,
    creditDisplay: '3',
    nature: 'TH + PR',
    totalHours: '47 hrs',
    year: 'Year 4',
    semester: 'VII/VIII',
    cluster: 'Cluster 3: Network and Internet',
    objectives: [
      'Study wireless ad-hoc and sensor networks, mobility models, MAC protocols, proactive/reactive/hybrid routing protocols, transport/security issues, cross-layer design, and wireless sensor applications.',
    ],
    outcomes: [
      'Analyze unique mobility, bandwidth, and energy constraints in MANETs and Wireless Sensor Networks (WSNs).',
      'Simulate and evaluate MAC, AODV, TCP/UDP, and LEACH protocols in wireless network simulators.',
    ],
    units: [
      {
        unitNumber: 1,
        title: 'Introduction to Ad-Hoc Networks',
        hours: '5 hrs',
        topics: [
          '1.1 Definition, Characteristics, Features, and Applications of Ad-Hoc Networks',
          '1.2 Ad-Hoc Mobility Models: Indoor and Outdoor Models; 1.3 Wireless Channel Characteristics',
        ],
      },
      {
        unitNumber: 2,
        title: 'Medium Access Control (MAC) Protocol',
        hours: '10 hrs',
        topics: [
          '2.1 Issues, goals, and classification in designing MAC protocols for wireless ad-hoc networks',
          '2.2 Scheduling algorithms and MAC protocols using directional antennas',
          '2.3 IEEE Standards: 802.11a/b/g, 802.15, HIPERLAN; 2.4 Real-Time, Multichannel, and Power-Aware MAC Protocols',
        ],
      },
      {
        unitNumber: 3,
        title: 'End-to-End Delivery and Security',
        hours: '8 hrs',
        topics: [
          '3.1 Transport Layer issues and ad-hoc transport protocols',
          '3.2 Security issues and attacks in ad-hoc networks, Secure routing protocols',
          '3.3 Wireless LAN, WAN, MAN, and PAN architectures and applications',
        ],
      },
      {
        unitNumber: 4,
        title: 'Routing Protocols',
        hours: '8 hrs',
        topics: [
          '4.1 Routing design issues, goals, and classifications',
          '4.2 Proactive vs. Reactive Routing, Unicast Routing Algorithms (DSDV, DSR, AODV)',
          '4.3 Multicast, Hybrid, Energy-Aware, Hierarchical, and QoS-Aware Routing Algorithms',
        ],
      },
      {
        unitNumber: 5,
        title: 'Cross-Layer Design',
        hours: '8 hrs',
        topics: [
          '5.1 Need for cross-layer design, 5.2 Cross-layer parameter optimization and cautionary perspectives, 5.3 Integration of ad-hoc networks with Mobile IP',
        ],
      },
      {
        unitNumber: 6,
        title: 'Networking Sensors and Applications',
        hours: '8 hrs',
        topics: [
          '6.1 Unique features and deployment of Wireless Sensor Networks (WSNs), 6.2 Sensor network programming challenges, 6.3 Applications and future directions',
        ],
      },
    ],
    laboratoryWork: [
      '1. Create a sample wireless topology and mobile ad-hoc network using a network simulation tool (NS-2 / NS-3 / OMNeT++).',
      '2. Implement and analyze the Ad-hoc On-demand Distance Vector (AODV) routing protocol.',
      '3. Simulate TCP and UDP performance over MANETs.',
      '4. Implement and evaluate the Low-Energy Adaptive Clustering Hierarchy (LEACH) protocol for wireless sensor networks.',
    ],
    textbooks: [
      'C.K. Toh, "Ad Hoc Mobile Wireless Networks: Protocols and Systems", Prentice Hall.',
      'C. Siva Ram Murthy and B.S. Manoj, "Ad Hoc Wireless Networks: Architectures and Protocols", Prentice Hall / Pearson.',
    ],
    references: [
      'Stefano Basagni et al., "Mobile Ad Hoc Networking", Wiley-IEEE Press, 2004.',
      'Mohammad Ilyas, "The Handbook of Ad Hoc Wireless Networks", CRC Press, 2002.',
    ],
  },
  {
    code: 'ELE',
    title: 'IPV6 Networking',
    credit: 3,
    creditDisplay: '3',
    nature: 'TH + PR',
    totalHours: '45 hrs',
    year: 'Year 4',
    semester: 'VII/VIII',
    cluster: 'Cluster 3: Network and Internet',
    note: 'Designated Cluster 3 Elective in the official BIT Curriculum structure (Page 14).',
    objectives: [
      'Master next-generation IPv6 addressing architecture, header formats, ICMPv6, Neighbor Discovery Protocol (NDP), SLAAC/DHCPv6, OSPFv3/BGP4+, IPv4-to-IPv6 transition mechanisms (Dual-Stack, Tunneling, NAT64), and IPv6 security.',
    ],
    units: [
      {
        unitNumber: 1,
        title: 'IPv6 Architecture, Addressing, Routing & Transition Mechanisms',
        hours: '45 hrs',
        topics: [
          'IPv6 128-bit Addressing (Unicast, Multicast, Anycast), Base & Extension Headers, ICMPv6, Neighbor Discovery Protocol (NDP), Stateless Address Autoconfiguration (SLAAC) & DHCPv6',
          'IPv6 Routing (RIPng, OSPFv3, MP-BGP4), Transition Mechanisms (Dual-Stack, 6to4, ISATAP, NAT64/DNS64), IPSec in IPv6, and Enterprise Deployment',
        ],
      },
    ],
  },
  {
    code: 'ELE',
    title: 'IOT and Smart Technologies',
    credit: 3,
    creditDisplay: '3',
    nature: 'TH + PR',
    totalHours: '45 hrs',
    year: 'Year 4',
    semester: 'VII/VIII',
    cluster: 'Cluster 3: Network and Internet',
    note: 'Listed as "IOT and Smart City" in Cluster 3 (Page 14) and "IOT and Smart Technologies" in the Micro-Syllabus (Page 151).',
    objectives: [
      'Understand core IoT concepts, sensors/gateways, LPWAN/cellular connectivity, Edge/Fog/Cloud processing, IoT data/network protocols (MQTT, CoAP, AMQP, LoRaWAN, ZigBee), security, BIM/GIS integration, and Smart City design.',
    ],
    outcomes: [
      'Architect and prototype secure IoT systems integrating sensors, microcontrollers/gateways, MQTT/CoAP protocols, and cloud dashboards.',
      'Design smart city solutions for energy grids, intelligent transportation, environmental monitoring, and smart infrastructure.',
    ],
    units: [
      {
        unitNumber: 1,
        title: 'Overview of Internet of Things (IoT)',
        hours: '4 hrs',
        topics: ['1.1 Definition of IoT, 1.2 History and industry growth trends, 1.3 Fundamental components, 1.4 Applications of IoT'],
      },
      {
        unitNumber: 2,
        title: 'Sensors and Devices Used in IoT',
        hours: '6 hrs',
        topics: ['2.1 Overview of sensors and actuators, 2.2 IoT device hardware, 2.3 Scaling, manufacturing, and shipping, 2.4 IoT Gateways'],
      },
      {
        unitNumber: 3,
        title: 'Connectivity',
        hours: '4 hrs',
        topics: ['3.1 Connectivity overview, 3.2 Cellular (NB-IoT, LTE-M, 5G), 3.3 Satellite, 3.4 Wi-Fi, Bluetooth/BLE, and LPWAN connectivity'],
      },
      {
        unitNumber: 4,
        title: 'Data Processing',
        hours: '4 hrs',
        topics: [
          '4.1 Cloud computing for IoT, 4.2 Choosing and migrating to an IoT Platform, 4.3 Edge and Fog Computing, 4.4 APIs for custom IoT integration',
        ],
      },
      {
        unitNumber: 5,
        title: 'IoT Protocols and Machine Learning',
        hours: '9 hrs',
        topics: [
          '5.1 IoT Data Protocols: MQTT, CoAP, AMQP, M2M Protocol, XMPP',
          '5.2 IoT Network Protocols: HTTP/HTTPS, LoRaWAN, Bluetooth, ZigBee',
          '5.3 Machine Learning for IoT sensor analytics',
        ],
      },
      {
        unitNumber: 6,
        title: 'User Interface and User Experience in IoT',
        hours: '2 hrs',
        topics: ['6.1 UI/UX principles, key considerations, and recent trends for IoT control dashboards'],
      },
      {
        unitNumber: 7,
        title: 'Security and Privacy in IoT',
        hours: '4 hrs',
        topics: [
          '7.1 IoT Security threats, 7.2 Authentication and access control, 7.3 Data privacy and compliance in smart cities, 7.4 Security best practices',
        ],
      },
      {
        unitNumber: 8,
        title: 'IoT for Smart Cities',
        hours: '3 hrs',
        topics: ['8.1 Smart city concepts, 8.2 Need for transformation, 8.3 Role of IoT in smart cities, 8.4 Global and local case studies'],
      },
      {
        unitNumber: 9,
        title: 'Other Technologies in Smart Cities',
        hours: '3 hrs',
        topics: [
          '9.1 Building Information Modeling (BIM) and GIS for smart cities (BIM dimensions, sustainability, lifecycle, BIM–GIS integration), 9.2 Big Data in Smart Cities',
        ],
      },
      {
        unitNumber: 10,
        title: 'Smart City Design',
        hours: '6 hrs',
        topics: [
          '10.1 Smart energy management and smart grids, 10.2 Smart transportation and traffic management, 10.3 Environmental monitoring, 10.4 Smart buildings, 10.5 Citizen participation',
        ],
      },
    ],
    laboratoryWork: [
      'Project-Based Learning: Students design, prototype, review with stakeholders, and demonstrate a hands-on IoT & Smart City solution tailored to their municipality.',
    ],
  },

  // ─── CLUSTER 4: SOFTWARE DEVELOPMENT ────────────────────────────────────
  {
    code: 'ELE',
    title: 'Visual Programming',
    credit: 3,
    creditDisplay: '3',
    nature: 'TH + PR',
    totalHours: '45 hrs',
    year: 'Year 4',
    semester: 'VII/VIII',
    cluster: 'Cluster 4: Software Development',
    objectives: [
      'Gain a solid understanding of Visual Programming concepts in C# and .NET, OOP principles, Windows Forms & WPF GUI development, ADO.NET & Entity Framework database connectivity, LINQ, and asynchronous programming.',
    ],
    outcomes: [
      'Build responsive, event-driven desktop applications using C#, Windows Forms, and Windows Presentation Foundation (WPF).',
      'Integrate relational databases using ADO.NET, Entity Framework (ORM), LINQ, and async/await multithreading.',
    ],
    units: [
      {
        unitNumber: 1,
        title: 'Introduction to Visual Programming and C# Basics',
        hours: '8 hrs',
        topics: [
          '1.1 Visual Programming concepts and benefits, 1.2 Visual Studio IDE, 1.3 .NET Framework architecture, 1.4 Compiling and executing .NET applications',
          '1.5 C# Program Structure, Variables, Data types, Operators, Namespaces, Control flow, foreach loops, Arrays, Strings, System.Collections, and LINQ',
        ],
      },
      {
        unitNumber: 2,
        title: 'Object-Oriented Concept in C#',
        hours: '7 hrs',
        topics: [
          '2.1 OOP Principles, Classes and Objects, Properties (get/set accessors), Encapsulation, Constructors and Destructors',
          '2.2 Inheritance (single, multilevel, multiple via interfaces), Method overriding, Abstract classes, Interfaces, and Exception handling in C#',
        ],
      },
      {
        unitNumber: 3,
        title: 'Graphical User Interface (GUI) Development',
        hours: '15 hrs',
        topics: [
          '3.1 GUI development with Windows Forms and WPF; Common controls (Button, Label, TextBox, CheckBox, ComboBox, RadioButton, ListBox, ListView)',
          '3.2 Containers (Panel, GroupBox, TabControl), Menus and Toolbars, DataSet and DataGridView, Dialogs (Color, Folder, Open/Save File, Font, Message)',
          '3.3 Delegates and Event Handling (Mouse, Keyboard, Window events), Data Binding and Validation',
          '3.4 Windows Presentation Foundation (WPF): XAML layout management, responsive/interactive controls, styling, and MDI Windows',
        ],
      },
      {
        unitNumber: 4,
        title: 'Database Connectivity',
        hours: '10 hrs',
        topics: [
          '4.1 ADO.NET Basics: Connection, Command, DataReader, and DataAdapter classes; Connection strings and CRUD operations',
          '4.2 Entity Framework (EF) & ORM: Database Providers, LINQ to Entities, Entity Classes, DbContext, and querying databases with LINQ',
        ],
      },
      {
        unitNumber: 5,
        title: 'Asynchronous Programming',
        hours: '5 hrs',
        topics: [
          '5.1 Multithreading and Asynchronous Programming principles, async/await patterns in C#, executing async tasks from a GUI, Timers, and BackgroundWorkers',
        ],
      },
    ],
    laboratoryWork: [
      'Create GUI applications in C# and .NET covering Windows Forms, WPF, ADO.NET, Entity Framework, LINQ, and async/await, culminating in a final project.',
    ],
    textbooks: [
      'Paul Deitel and Harvey Deitel, 2018, "Visual C#: How to Program", 6th Edition, Pearson Education Asia.',
    ],
    references: [
      'Joseph Albahari and Ben Albahari, 2021, "C# 9.0 in a Nutshell: The Definitive Reference", O’Reilly Media.',
    ],
  },
  {
    code: 'ELE',
    title: 'Agile Software Development',
    credit: 3,
    creditDisplay: '3',
    nature: 'TH + PR',
    totalHours: '45 hrs',
    year: 'Year 4',
    semester: 'VII/VIII',
    cluster: 'Cluster 4: Software Development',
    note: 'Designated Cluster 4 Elective in the official BIT Curriculum structure (Page 14).',
    objectives: [
      'Master Agile Manifesto values and principles, Scrum roles/ceremonies/artifacts, Kanban flow, Extreme Programming (XP), Test-Driven Development (TDD), user story estimation, sprint velocity tracking, and scaled agile delivery.',
    ],
    units: [
      {
        unitNumber: 1,
        title: 'Agile Principles, Scrum, Kanban, XP & Continuous Delivery',
        hours: '45 hrs',
        topics: [
          'Agile Manifesto & 12 Principles, Scrum Framework (Product Owner, Scrum Master, Developers, Product/Sprint Backlogs, Sprint Planning, Daily Standup, Review, Retrospective)',
          'User Stories, Acceptance Criteria, Story Point Estimation (Planning Poker), Velocity & Burndown Charts, Kanban & WIP Limits, Extreme Programming (TDD, Pair Programming, Refactoring, CI/CD)',
        ],
      },
    ],
  },
  {
    code: 'ELE',
    title: 'Software Quality Assurance',
    credit: 3,
    creditDisplay: '3',
    nature: 'TH + PR',
    totalHours: '45 hrs',
    year: 'Year 4',
    semester: 'VII/VIII',
    cluster: 'Cluster 4: Software Development',
    objectives: [
      'Provide a comprehensive understanding of software testing principles, SQA lifecycle components, verification (walkthroughs, inspections, audits), validation, black-box/white-box test design, test automation tools, and quality standards (ISO, CMMI, Six Sigma, IEEE).',
    ],
    outcomes: [
      'Prepare comprehensive SQA & Test Plans and design Black-Box, White-Box, and Experience-Based test suites.',
      'Execute automated and manual testing, track defects, and apply ISO/CMMI/IEEE quality standards.',
    ],
    units: [
      {
        unitNumber: 1,
        title: 'Software Testing & Software Quality',
        hours: '5 hrs',
        topics: [
          '1.1 Software errors, faults, and failures; 1.2 Software testing & 1.3 Testing principles; 1.4 Software quality vs. SQA; 1.5 Psychology and 1.6 Ethics of testing; 1.7 Testing as a career',
        ],
      },
      {
        unitNumber: 2,
        title: 'SQA Components in Project Life-Cycle',
        hours: '3 hrs',
        topics: ['2.1 SDLC models and SQA integration, 2.2 Levels of testing (Unit, Integration, System, Acceptance), 2.3 Types of testing'],
      },
      {
        unitNumber: 3,
        title: 'Software Verification',
        hours: '5 hrs',
        topics: ['3.1 Walkthroughs, 3.2 Formal Inspections, 3.3 Software Audits, 3.4 Verification processes'],
      },
      {
        unitNumber: 4,
        title: 'Software Validation',
        hours: '5 hrs',
        topics: [
          '4.1 Validation of software design, 4.2 Validation of product specifications, 4.3 Validation of software product, 4.4 Testing different software product domains',
        ],
      },
      {
        unitNumber: 5,
        title: 'Software Product Quality',
        hours: '3 hrs',
        topics: ['5.1 Software disasters: causes and consequences; 5.2 Software reliability models and quality improvement'],
      },
      {
        unitNumber: 6,
        title: 'Software Process Quality',
        hours: '3 hrs',
        topics: ['6.1 Process quality, 6.2 Software development process components, 6.3 Process improvement and stabilization'],
      },
      {
        unitNumber: 7,
        title: 'Test Techniques',
        hours: '6 hrs',
        topics: [
          '7.1 Static testing vs. Dynamic testing',
          '7.2 Black-Box Testing: Equivalence Partitioning, Boundary Value Analysis (BVA), Decision Table Testing, State Transition Testing, Use Case Testing',
          '7.3 White-Box Testing: Statement Coverage and Decision/Branch Coverage',
          '7.4 Experience-Based Testing: Error Guessing, Exploratory Testing, Checklist-Based Testing',
        ],
      },
      {
        unitNumber: 8,
        title: 'Test Management',
        hours: '7 hrs',
        topics: [
          '8.1 Test organization, 8.2 Test planning, estimation, and quality metrics, 8.3 Test monitoring and control, 8.4 Configuration management, 8.5 Risk management, 8.6 Defect lifecycle management',
        ],
      },
      {
        unitNumber: 9,
        title: 'Testing Tools',
        hours: '6 hrs',
        topics: [
          '9.1 Test tool considerations, 9.2 Test automation benefits and risks, 9.3 Test execution and management tools, 9.4 Tool selection principles, 9.5 Critical success factors',
        ],
      },
      {
        unitNumber: 10,
        title: 'Quality Management Standards',
        hours: '2 hrs',
        topics: ['10.1 Scope of quality standards; 10.2 Total Quality Management (TQM), ISO 9001/25010, CMMI, Six Sigma, and IEEE Testing Standards'],
      },
    ],
    laboratoryWork: [
      'Hands-on software testing labs covering unit testing, equivalence/boundary test case design, white-box coverage analysis, automated UI/API testing, and defect tracking.',
    ],
    textbooks: [
      'Daniel Galin, "Software Quality Assurance: From Theory to Implementation", Pearson Education, 2004.',
      'Murali Chemuturi, "Mastering Software Quality Assurance: Best Practices, Tools and Techniques for Software Developers", J. Ross Publishing, 2010.',
    ],
    references: [
      'Capers Jones and Olivier Bonsignour, "The Economics of Software Quality", Pearson Education, 2012.',
      'Kshirasagar Naik and Priyadarshi Tripathy, "Software Testing and Quality Assurance: Theory and Practice", Wiley, 2008.',
      'Ron Patton, "Software Testing", Sams Publishing, 2001.',
    ],
  },

  // ─── CLUSTER 5: GEOGRAPHIC INFORMATION SYSTEM ───────────────────────────
  {
    code: 'ELE',
    title: 'Remote Sensing',
    credit: 3,
    creditDisplay: '3',
    nature: 'TH + PR',
    totalHours: '45 hrs',
    year: 'Year 4',
    semester: 'VII/VIII',
    cluster: 'Cluster 5: Geographic Information System',
    objectives: [
      'Provide fundamental knowledge of Earth surface remote sensing from spaceborne and airborne platforms, electromagnetic radiation physics, sensor resolutions, Earth observation satellite missions, digital image processing, and environmental applications.',
    ],
    outcomes: [
      'Evaluate Earth observation satellite systems (Landsat, Sentinel, MODIS, WorldView) and sensor resolutions.',
      'Perform radiometric/geometric image enhancement, spectral index calculation (NDVI, NDBI, NDWI), supervised/unsupervised classification, and accuracy assessment.',
    ],
    units: [
      {
        unitNumber: 1,
        title: 'Introduction',
        hours: '5 hrs',
        topics: [
          'Remote Sensing and GIS integration, Historical Overview, Image Characteristics, GPS, Characteristics of Real Remote Sensing Systems, and Applications',
        ],
      },
      {
        unitNumber: 2,
        title: 'Science of Remote Sensing',
        hours: '5 hrs',
        topics: [
          'Radiation and Energy Sources, Electromagnetic Spectrum, Energy Interactions with Atmosphere and Earth Surface, Passive vs. Active Sensing, Optical, Microwave, and Hyperspectral Remote Sensing',
        ],
      },
      {
        unitNumber: 3,
        title: 'Sensors',
        hours: '5 hrs',
        topics: [
          'Sensor Types and Characteristics, Across-Track vs. Along-Track Scanning, Optical-Mechanical Scanners (MSS, TM, LISS, WiFS, PAN), Spatial, Spectral, Temporal, and Radiometric Resolutions',
        ],
      },
      {
        unitNumber: 4,
        title: 'Earth Observation Space Programs',
        hours: '10 hrs',
        topics: [
          'Satellite Constellations and Orbits (GEO, MEO, LEO, SSO, GTO), Satellite Functions, Major Missions (Landsat, Sentinel, MODIS, WorldView) and Sensor/Swath/FOV Attributes',
        ],
      },
      {
        unitNumber: 5,
        title: 'Digital Image Processing, Interpretation and Analysis',
        hours: '10 hrs',
        topics: [
          'Visual Image Interpretation Elements and Keys, Digital Image Preprocessing and Enhancement, Supervised vs. Unsupervised Image Classification, Quantitative Accuracy Assessment',
        ],
      },
      {
        unitNumber: 6,
        title: 'Remote Sensing Applications',
        hours: '10 hrs',
        topics: [
          'Applications in Disaster Management (Earthquake, Flood, Landslide), Urbanization and Settlement Mapping, Agriculture and Forestry, Land Use and Land Cover (LULC) Monitoring',
        ],
      },
    ],
    laboratoryWork: [
      '1. USGS EarthExplorer satellite data acquisition and map composition.',
      '2. Multispectral band combinations and color composites.',
      '3. Low-resolution and high-resolution satellite image exploration.',
      '4. Image enhancement and DN-to-Radiance mathematical conversion.',
      '5. Spectral Indices calculation: NDVI, NDBI, and NDWI.',
      '6. Unsupervised and Supervised LULC Classification and Accuracy Assessment (Kappa / Confusion Matrix).',
    ],
    textbooks: [
      'Thomas M. Lillesand, Ralph W. Kiefer, and Jonathan W. Chipman (2015), "Remote Sensing and Image Interpretation", John Wiley & Sons.',
      'Jian Guo Liu and Philippa J. Mason (2016), "Image Processing and GIS for Remote Sensing: Techniques and Applications", Wiley-Blackwell.',
    ],
    references: [
      'James B. Campbell (2002), "Introduction to Remote Sensing", Taylor & Francis.',
      'George Joseph (2003), "Fundamentals of Remote Sensing", Universities Press.',
      'Floyd F. Sabins (1985), "Remote Sensing: Principles and Interpretation", W.H. Freeman.',
    ],
  },
  {
    code: 'ELE',
    title: 'Geographic Information System (GIS)',
    credit: 3,
    creditDisplay: '3',
    nature: 'TH + PR',
    totalHours: '45 hrs',
    year: 'Year 4',
    semester: 'VII/VIII',
    cluster: 'Cluster 5: Geographic Information System',
    objectives: [
      'Provide fundamental knowledge of Geographic Information Systems (GIS), digital cartography, coordinate projection systems (UTM), vector/raster spatial data structures, geodatabases, spatial analysis, and Web/Cloud GIS.',
    ],
    outcomes: [
      'Digitize, manage, and query spatial and non-spatial datasets in QGIS / ArcGIS and PostGIS.',
      'Perform vector overlay/buffer/network analysis, raster map algebra, and Web Map Service (WMS) publishing.',
    ],
    units: [
      {
        unitNumber: 1,
        title: 'Introduction',
        hours: '5 hrs',
        topics: [
          'Geographic Information Systems, Historical Overview, Components and Functional Elements of GIS, Remote Sensing Data in GIS, Scope and Applications',
        ],
      },
      {
        unitNumber: 2,
        title: 'Digital Mapping and Cartography',
        hours: '8 hrs',
        topics: [
          'Maps, Map Elements, Map Layers, Map Scales, Coordinate Systems, Map Projections, Cartographic Design, Reference Surfaces, Universal Transverse Mercator (UTM) Projection',
        ],
      },
      {
        unitNumber: 3,
        title: 'GIS Data Structures',
        hours: '8 hrs',
        topics: [
          'Vector and Raster Data Structures, Spatial Indexing, Topology and Spatial Relationships, Triangulated Irregular Network (TIN), Lossy vs. Lossless Compression (Run-Length, Huffman, LZW), Tiling and Pyramid Structures',
        ],
      },
      {
        unitNumber: 4,
        title: 'GIS Data Management',
        hours: '6 hrs',
        topics: [
          'Spatial vs. Non-Spatial Database Queries, Geodatabases, Spatial Data Infrastructures (SDI), GIS Data Formats (GeoJSON, Shapefiles, GeoTIFF, SQLite/GeoPackage, KML), Data Integration and Interoperability',
        ],
      },
      {
        unitNumber: 5,
        title: 'Spatial Data Analysis',
        hours: '8 hrs',
        topics: [
          'Raster Data Analysis: Reclassifying, Resampling, Map Algebra',
          'Vector Data Analysis: Geometric Operations (Overlay, Buffer, Clip, Union, Intersection), Spatial Queries (Point-in-Polygon, Distance-Based, Spatial Joins), Network Analysis, Spatial Autocorrelation',
        ],
      },
      {
        unitNumber: 6,
        title: 'GIS Trends and Applications',
        hours: '10 hrs',
        topics: [
          'FOSS4G, OSGeo, Mobile GIS, Cloud-Based GIS, Big Data and Geospatial Analytics, Open Data and Open-Source GIS',
          'Applications in Disaster Management, Urbanization and Settlement Mapping, Agriculture and Forestry, Public Health and Environment',
        ],
      },
    ],
    laboratoryWork: [
      '1. Introduction to QGIS / ArcGIS: workspace structure, tools, coordinate systems, and formats.',
      '2. GIS data collection from GPS, field surveys, and satellite remote sensing.',
      '3. Georeferencing, digitization, and cartographic map production in QGIS / ArcGIS.',
      '4. Spatial and attribute querying in geodatabases.',
      '5. Publishing an interactive Web Map Service (WMS).',
      '6. Raster terrain and map algebra analysis.',
    ],
    textbooks: [
      'Paul A. Longley, Michael F. Goodchild, David J. Maguire, and David W. Rhind (2015), "Geographic Information Science and Systems", 4th Edition, Wiley.',
      'Kang-tsung Chang, "Introduction to Geographic Information Systems", 6th Edition, McGraw-Hill.',
    ],
    references: [
      'Ian Heywood, Sarah Cornelius, and Steve Carver (2012), "An Introduction to Geographical Information Systems", Pearson.',
      'Markus Neteler and Helena Mitasova (2009), "Open Source GIS: A GRASS GIS Approach", 3rd Edition, Springer.',
    ],
  },
  {
    code: 'ELE',
    title: 'Geo Spatial Data Processing and Management',
    credit: 3,
    creditDisplay: '3',
    nature: 'TH + PR',
    totalHours: '45 hrs',
    year: 'Year 4',
    semester: 'VII/VIII',
    cluster: 'Cluster 5: Geographic Information System',
    objectives: [
      'Provide fundamental knowledge of geospatial data acquisition (LiDAR, GPS, Remote Sensing, Crowdsourcing), spatial databases (PostGIS), spatial indexing and query languages, thematic cartographic visualization, and Volunteered Geographic Information (VGI).',
    ],
    outcomes: [
      'Acquire, fuse, validate, and store multi-source geospatial datasets in spatial databases such as PostGIS.',
      'Build choropleth, dot-density, heatmap, and cluster visualizations and analyze Volunteered Geographic Information (VGI).',
    ],
    units: [
      {
        unitNumber: 1,
        title: 'Introduction to Geospatial Data',
        hours: '7 hrs',
        topics: [
          '1.1 Spatial and Geospatial Data types and characteristics, 1.2 Volunteered Geographic Information (VGI) and its types, 1.3 Spatial Social Networks, 1.4 GeoPrivacy, 1.5 Challenges and Applications',
        ],
      },
      {
        unitNumber: 2,
        title: 'Geospatial Data Acquisition',
        hours: '10 hrs',
        topics: [
          '2.1 Data Sources (Remote Sensing, GPS, Field Surveying, LiDAR, Crowd-Sourced Data), 2.2 Data Collection, 2.3 Data Fusion and Integration, 2.4 Preprocessing, 2.5 Validation and Quality Assurance',
        ],
      },
      {
        unitNumber: 3,
        title: 'Geospatial Data Processing and Analysis',
        hours: '10 hrs',
        topics: [
          '3.1 Spatial statistics and analysis techniques, 3.2 Geospatial Databases and Models (PostGIS), 3.3 Spatial Data Modeling, 3.4 Spatial Indexing (R-Tree / Quadtree), 3.5 Geospatial Query Language (Spatial SQL), 3.6 Backup, Storage, and Exchange (GeoJSON, GeoPackage, Shapefiles)',
        ],
      },
      {
        unitNumber: 4,
        title: 'Geospatial Data Visualization',
        hours: '8 hrs',
        topics: [
          '4.1 Cartographic visualization principles, 4.2 Choropleth maps, 4.3 Dot-density maps, 4.4 Heatmaps, 4.5 Cluster maps, 4.6 Thematic maps, 4.7 Map visualizations using Spatial SQL, 4.8 Emerging trends',
        ],
      },
      {
        unitNumber: 5,
        title: 'Case Study: Volunteered Geographic Information (VGI)',
        hours: '10 hrs',
        topics: [
          '5.1 VGI & User-Generated Content (OpenStreetMap), 5.2 Crowdsourced Data Collection, Preprocessing, and Quality Assessment, 5.3 VGI Spatial Analysis, Visualization, and Dataset Integration, 5.4 Applications in Public Health, Disease Tracking, Tourism, and Urban Mobility',
        ],
      },
    ],
    laboratoryWork: [
      '1. Multi-source Geospatial Data Acquisition and Preprocessing.',
      '2. Spatial Database setup and Spatial SQL querying in PostGIS.',
      '3. Thematic Geospatial Data Visualization (Choropleth, Heatmaps, Cluster Maps).',
      '4. VGI Case Study implementation using OpenStreetMap / crowdsourced spatial data.',
    ],
    textbooks: [
      'Michael J. de Smith, Michael F. Goodchild, and Paul A. Longley (2007), "Geospatial Analysis: A Comprehensive Guide to Principles, Techniques and Software Tools", Troubador Publishing.',
      'Wenzhong Shi, Michael F. Goodchild, Brian Lees, and Yee Leung (2012), "Advances in Geo-Spatial Information Science", CRC Press.',
      'Daniel Sui, Sarah Elwood, and Michael Goodchild (2012), "Crowdsourcing Geographic Knowledge: Volunteered Geographic Information (VGI) in Theory and Practice", Springer.',
    ],
  },
];
