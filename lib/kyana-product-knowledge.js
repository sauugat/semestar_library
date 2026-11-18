'use strict';

const {
    detectLanguage,
    STRICT_OFF_TOPIC_PATTERN,
    isOtherStudentDataRequest
} = require('./chat-security');

const PRODUCT_KNOWLEDGE_VERSION = '2026.11.1';

const SEMESTER_LIBRARY_IDENTITY = Object.freeze({
    name: 'Semester Library',
    institution: 'Gandaki University (GU)',
    university: 'Gandaki University (GU)',
    program: 'Bachelor of Information Technology (BIT)',
    semesters: 'Semesters 1 to 8',
    cohorts: Object.freeze(['MERCURY', 'VENUS', 'EARTH', 'MARS']),
    location: 'Pokhara, Gandaki Province, Nepal',
    founderAndDeveloper: 'Saugat & Contributors (Semester Library Engineering)',
    repository: 'sauugat/semestar_library',
    purpose: 'The official digital academic library, campus communication hub, coding lab, and student utility platform built for Gandaki University BIT students, Class Representatives (CRs), teachers, and administrators.'
});

const KYANA_AI_IDENTITY = Object.freeze({
    name: 'Kyana AI',
    shortName: 'Kyana',
    fullForm: 'Knowledge Yielding Academic Navigation Assistant',
    creator: 'Saugat & Contributors (Semester Library Engineering)',
    platform: 'Semester Library (Gandaki University BIT)',
    roles: [
        'Gandaki University BIT Academic Assistant (syllabus, notes, notices, routine, attendance, marks, and programming tutor)',
        'Official Semester Library Product Guide & Support Assistant (platform features, usage instructions, permissions, privacy rules, FAQs, and troubleshooting)'
    ]
});

/**
 * Pattern that matches live personal record lookups or live academic content fetches
 * where the user wants their own database records or subject study notes rather than
 * product documentation, rules, or how-to guidance.
 */
const LIVE_PERSONAL_OR_ACADEMIC_DATA_QUERY = /\b(?:what\s+is\s+my\s+(?:attendance|marks?|results?|grade|gpa|percentage|routine|schedule)|show\s+(?:me\s+)?my\s+(?:attendance|marks?|results?|grades?|report\s*card|routine|assignments?|submissions?)|check\s+my\s+(?:attendance|marks?|results?|grades?|submissions?)|am\s+i\s+(?:safe\s+in\s+attendance|present\s+today|absent\s+today|passing)|mera?\s+(?:attendance|marks?|result|routine)\s+(?:kati|kasto|dekhau|hera)|mero\s+(?:hajiri|ankha|natija|routine)\s+(?:kati|kasto|dekhau|hera)|any\s+(?:new\s+)?(?:notices?|announcements?|posts?)\s+(?:today|this\s+week|for\s+semester)|what\s+is\s+(?:today'?s|tomorrow'?s)\s+routine|which\s+class\s+(?:do\s+i\s+have|is\s+next))\b/i;

/**
 * Explicit product/rule/how-to/troubleshooting framing that overrides LIVE_PERSONAL_OR_ACADEMIC_DATA_QUERY
 * when a user asks *how* a feature works, *why* a rule/lock exists, or *who* has permission.
 */
const EXPLICIT_PRODUCT_HELP_FRAMING = /\b(?:what\s+is\s+the\s+full\s+form|what\s+does\s+kyana\s+stand\s+for|meaning\s+of\s+kyana|knowledge\s+yielding|who\s+(?:founded|created|developed|built|made|owns)|(?:founder|creator|developer)s?\s+of|what\s+is\s+semester\s+library|how\s+(?:do\s+i|to|can\s+i|does|do)|why\s+(?:can'?t|cannot|did(?:n'?t)?|do(?:esn'?t)?|is\s+my|are\s+my)|(?:edit|time)\s+window|24[\s-]*hours?|15[\s-]*minutes?|milestone|multiples?\s+of\s+10|10\s+(?:likes?|upvotes?|votes?)|read\s+receipts?|soft[\s-]*delete|hard[\s-]*delete|draft\s+(?:marks?|results?)|students_only|permission|permissions|allowed\s+to|who\s+can\s+(?:upload|edit|delete|post|pin|mark|grade|verify|promote)|troubleshoot|not\s+(?:receiving|getting|working|showing)\s+notification|delete\s+(?:my\s+)?account|change\s+(?:my\s+)?(?:password|semester|username|avatar)|kyana\s+ko\s+(?:full\s+form|pura\s+rup|artha)|kasari\s+(?:use\s+garne|chalauxa|kam\s+garxa|upload\s+garne|delete\s+garne|change\s+garne|report\s+garne)|kina\s+(?:notification\s+aayena|edit\s+hudaina|change\s+hudaina|upload\s+hudaina|dekhidaina))\b/i;

const PRODUCT_KNOWLEDGE_TOPICS = Object.freeze([
    {
        id: 'kyana_identity',
        title: 'Kyana AI Identity & Full Form',
        priority: 100,
        isIdentityOrFounder: true,
        patterns: [
            /\b(?:full\s+form\s+of\s+kyana|kyana(?:'s)?\s+full\s+form|what\s+does\s+kyana\s+(?:stand\s+for|mean)|meaning\s+of\s+kyana|acronym\s+(?:of|for)\s+kyana|knowledge\s+yielding\s+academic\s+navigation\s+assistant)\b/i,
            /\b(?:kyana\s+ko\s+(?:full\s+form|pura\s+rup|pura\s+naam|artha|matlab)|kyana\s+bhaneko\s+k\s+ho|what\s+is\s+kyana(?:\s+ai)?|tell\s+me\s+about\s+kyana(?:\s+ai)?|kyana\s+features|what\s+can\s+kyana\s+do)\b/i,
            /(?:क्यानाको\s+पूरा\s+(?:रूप|नाम)|क्याना\s+भनेको\s+के\s+हो|क्याना\s+एआई\s+के\s+हो)/u
        ],
        factSheet: [
            'Full form of Kyana: Knowledge Yielding Academic Navigation Assistant.',
            'Creator & Developer: Saugat & Contributors (Semester Library Engineering) for Gandaki University BIT.',
            'Dual Role: (1) BIT Academic Assistant (syllabus Semesters 1–8, chapter notes, PDF study companion, notices, class routine, personal attendance/marks lookups, and Code Lab tutor) and (2) Official Semester Library Product Guide & Support Assistant.',
            'Key Capabilities: Direct chat at /kyana, split-screen "Ask Kyana AI" inside Library PDF notes, automated @kyana comment replies on posts/files/assignments, and two personality modes (roast and helpful).'
        ].join(' '),
        buildReply({ lang }) {
            if (lang === 'devanagari') {
                return [
                    '**Kyana AI (क्याना एआई)** को पूरा रूप **Knowledge Yielding Academic Navigation Assistant** हो।',
                    '',
                    'यो **Semester Library (Gandaki University BIT)** को आधिकारिक एआई सहायक हो, जसलाई **Saugat & Contributors** ले विकास गरेका हुन्। यसका मुख्य २ भूमिकाहरू छन्:',
                    '- **BIT Academic Assistant:** सेमेस्टर १ देखि ८ सम्मका पाठ्यक्रम (syllabus), नोट्स, PDF अध्ययन, कक्षा रुटिन, हाजिरी (attendance), नतिजा (results) र कोडिङमा सहयोग गर्ने।',
                    '- **Semester Library Product Guide & Support:** प्लेटफर्मका फिचरहरू, नियम, अनुमति (permissions), गोपनीयता, र प्राविधिक समस्या समाधानमा मार्गदर्शन गर्ने (तपाईंले पोस्ट वा फाइलको कमेन्टमा `@kyana` मेन्सन गरेर पनि प्रश्न सोध्न सक्नुहुन्छ)।'
                ].join('\n');
            }
            if (lang === 'romanized_nepali' || lang === 'mixed') {
                return [
                    '**Kyana AI** ko full form **Knowledge Yielding Academic Navigation Assistant** ho.',
                    '',
                    'Yo **Semester Library (Gandaki University BIT)** ko official AI companion ra product support guide ho, jaslai **Saugat & Contributors** le build gareka hun. Yesko 2 wota main roles chhan:',
                    '- **BIT Academic Assistant:** Semester 1–8 ko syllabus, chapter notes, split-screen PDF study ("Ask Kyana AI"), notices, class routine, attendance, published marks, ra Code Lab programming ma help garne.',
                    '- **Semester Library Product Guide & Support:** Platform features, privacy rules, notifications, permissions, FAQs, ra troubleshooting guide garne (posts/files ko comment ma `@kyana` tag garda pani auto-reply dinchha).'
                ].join('\n');
            }
            return [
                '**Kyana AI** stands for **Knowledge Yielding Academic Navigation Assistant**.',
                '',
                'Built by **Saugat & Contributors** for **Semester Library** at **Gandaki University (BIT)**, Kyana serves two core roles:',
                '- **BIT Academic Assistant:** Helps you study Semesters 1–8 syllabus topics, summarize Library notes via split-screen **Ask Kyana AI**, check campus notices and routines, review your own attendance and published exam marks, and debug Code Lab programming problems.',
                '- **Semester Library Product Guide & Support Assistant:** Explains how Semester Library works—including permissions, notification rules, privacy safeguards, messaging, and troubleshooting (and replies in comment threads whenever you mention `@kyana`).'
            ].join('\n');
        }
    },
    {
        id: 'founder_developer',
        title: 'Founder & Developer of Semester Library and Kyana AI',
        priority: 98,
        isIdentityOrFounder: true,
        patterns: [
            /\b(?:who\s+(?:is\s+(?:the\s+)?)?(?:founder|creator|developer|author|builder|maker)(?:\s+and\s+(?:developer|founder|creator))?\s+of\s+(?:the\s+)?(?:semester\s+library|kyana(?:\s+ai)?)|who\s+(?:founded|created|developed|built|made|designed|owns|authored)\s+(?:the\s+)?(?:semester\s+library|kyana(?:\s+ai)?|this\s+(?:app|platform|website|portal)))\b/i,
            /\b(?:(?:founder|creator|developer|author|owner|builder|maker|team)s?\s+(?:of|behind)\s+(?:the\s+)?(?:semester\s+library|kyana(?:\s+ai)?|this\s+(?:app|platform|website)))\b/i,
            /\b(?:semester\s+library\s+ko\s+(?:founder|creator|developer)|(?:semester\s+library|kyana(?:\s+ai)?)\s+kasle\s+ban(?:ako|ayeko|ayo)|kasle\s+ban(?:ako|ayeko|ayo)\s+(?:semester\s+library|kyana)|who\s+is\s+saugat)\b/i,
            /(?:सेमेस्टर\s+लाइब्रेरी\s+कसले\s+बनाएको|संस्थापक|डेभलपर\s+को\s+हो)/u
        ],
        factSheet: [
            'Founder & Lead Developer: Saugat & Contributors (Semester Library Engineering, repository sauugat/semestar_library).',
            'Platform: Semester Library and Kyana AI (Knowledge Yielding Academic Navigation Assistant).',
            'Target Institution: Gandaki University (GU), Bachelor of Information Technology (BIT) program in Pokhara, Nepal.'
        ].join(' '),
        buildReply({ lang }) {
            if (lang === 'devanagari') {
                return [
                    '**Semester Library** र **Kyana AI (Knowledge Yielding Academic Navigation Assistant)** का संस्थापक तथा मुख्य डेभलपर **Saugat & Contributors** (Semester Library Engineering, `sauugat/semestar_library`) हुन्।',
                    '',
                    'यो प्लेटफर्म **गण्डकी विश्वविद्यालय (Gandaki University)** का **BIT (Bachelor of Information Technology)** विद्यार्थी, शिक्षक, CR र प्रशासनका लागि अध्ययन सामग्री, कोडिङ ल्याब, हाजिरी, नतिजा र क्याम्पस संवादलाई एउटै ठाउँमा सहज बनाउन निर्माण गरिएको हो।'
                ].join('\n');
            }
            if (lang === 'romanized_nepali' || lang === 'mixed') {
                return [
                    '**Semester Library** ra **Kyana AI (Knowledge Yielding Academic Navigation Assistant)** ko founder ra lead developer **Saugat & Contributors** (Semester Library Engineering, `sauugat/semestar_library`) hun.',
                    '',
                    'Yo platform **Gandaki University (BIT)** ko students, CRs, teachers, ra admins ko lagi notes, Code Lab, attendance, published marks, cohort chat, ra AI academic support ekai thau ma dina banaiyeko ho.'
                ].join('\n');
            }
            return [
                '**Semester Library** and **Kyana AI (Knowledge Yielding Academic Navigation Assistant)** were founded and developed by **Saugat & Contributors** (`sauugat/semestar_library`, Semester Library Engineering).',
                '',
                'The platform was built specifically for the **Gandaki University (GU) Bachelor of Information Technology (BIT)** community in Pokhara to unify Semesters 1–8 study materials, Code Lab assignments, cohort messaging, attendance tracking, published exam results, and AI-assisted learning.'
            ].join('\n');
        }
    },
    {
        id: 'semester_library_identity',
        title: 'Semester Library Identity, Purpose & Core Modules',
        priority: 95,
        isIdentityOrFounder: true,
        patterns: [
            /\b(?:what\s+is\s+semester\s+library|about\s+semester\s+library|purpose\s+of\s+semester\s+library|semester\s+library\s+bhaneko\s+k\s+ho|tell\s+me\s+about\s+this\s+(?:platform|app|website|portal)|what\s+features\s+does\s+semester\s+library\s+have)\b/i,
            /(?:सेमेस्टर\s+लाइब्रेरी\s+के\s+हो|सेमेस्टर\s+लाइब्रेरीको\s+बारेमा)/u
        ],
        factSheet: [
            'Semester Library is the official academic and campus collaboration platform for Gandaki University BIT (Semesters 1 to 8), created by Saugat & Contributors.',
            'Core modules: (1) Academic Library (Semester -> Subject -> Chapter -> Notes/PDFs), (2) Kyana AI (Knowledge Yielding Academic Navigation Assistant), (3) Community Feed & Notices, (4) Code Lab (coding assignments, test cases, and 0.85 Jaccard similarity checker), (5) Cohort Group Chat (MERCURY, VENUS, EARTH, MARS) & Verified Direct Messaging, (6) Attendance Tracking (24-hour teacher edit window), (7) Published Exam Marks & A4 PDF Report Cards (45% pass threshold), and (8) Class Routine & Campus Games.'
        ].join(' '),
        buildReply({ lang }) {
            if (lang === 'devanagari') {
                return [
                    '**Semester Library** गण्डकी विश्वविद्यालय (Gandaki University) को **BIT (सेमेस्टर १–८)** कार्यक्रमका लागि **Saugat & Contributors** द्वारा निर्मित एकीकृत शैक्षिक र क्याम्पस प्लेटफर्म हो।',
                    '',
                    '- **Academic Library:** सेमेस्टर १–८ का विषय र अध्याय अनुसार नोट्स, PDF प्रिव्यू र डाउनलोड (`Semester -> Subject -> Chapter -> Notes`)।',
                    '- **Kyana AI:** शैक्षिक ट्युटर र प्लेटफर्म सपोर्ट गाइड (**Knowledge Yielding Academic Navigation Assistant**)।',
                    '- **Community Feed & Notices:** सूचना (`notice`), घोषणा, पोस्ट, भोटिङ र `@kyana` कमेन्ट सहायता।',
                    '- **Code Lab:** प्रोग्रामिङ असाइनमेन्ट, अटोमेटिक टेस्ट-केस मूल्याङ्कन र कोड समानता जाँच।',
                    '- **Cohort Chat & Direct Messaging:** कोहोर्ट च्याट (`MERCURY`, `VENUS`, `EARTH`, `MARS`) र भेरिफाइड १-अन-१ मेसेजिङ।',
                    '- **Attendance, Results & Routine:** हाजिरी ट्र्याकिङ, प्रकाशित परीक्षाको नतिजा (A4 PDF Report Card सहित) र कक्षा रुटिन।'
                ].join('\n');
            }
            if (lang === 'romanized_nepali' || lang === 'mixed') {
                return [
                    '**Semester Library** Gandaki University ko **BIT (Semesters 1–8)** students, CRs, teachers, ra admins ko lagi **Saugat & Contributors** le banayeko academic ra campus platform ho.',
                    '',
                    '- **Academic Library:** `Semester -> Subject -> Chapter -> Notes` structure ma PDF preview, download, ra split-screen **Ask Kyana AI**.',
                    '- **Community Feed & Notices:** Official notices, discussions, upvotes/downvotes, nested replies, ra `@kyana` comment mentions.',
                    '- **Code Lab:** Coding assignments, automated test-case evaluation (`10/min` limit), teacher grading, ra similarity check.',
                    '- **Cohort Chat & DMs:** Cohort rooms (`MERCURY`, `VENUS`, `EARTH`, `MARS`) ra verified 1-on-1 Direct Messaging.',
                    '- **Attendance, Results & Routine:** Subject-wise attendance tracking, published exam marks (`45%` pass threshold) with A4 PDF Report Cards, ra class routines.'
                ].join('\n');
            }
            return [
                '**Semester Library** is the academic learning, communication, and campus management platform built by **Saugat & Contributors** for the **Bachelor of Information Technology (BIT)** program (Semesters 1–8) at **Gandaki University**.',
                '',
                '- **Academic Library:** Organized hierarchy (`Semester -> Subject -> Chapter -> Notes`) with inline PDF viewing, downloads, and split-screen **Ask Kyana AI** tutoring.',
                '- **Community Feed & Notices:** Role-aware posts (`notice`, `announcement`, `news`, `general`, `complaints`, `feedback`), `everyone` vs `students_only` visibility, voting, and `@kyana` comment replies.',
                '- **Code Lab:** Programming assignments with automated test-case grading (`10 submissions/min`), controlled grade release, and Jaccard similarity checking.',
                '- **Cohort Chat & Direct Messaging:** Cohort rooms (`MERCURY`, `VENUS`, `EARTH`, `MARS`) plus 1-on-1 DMs for verified users with read receipts and a 15-minute edit window.',
                '- **Attendance, Results & Routine:** Personal attendance dashboards (24-hour teacher edit window), published exam results (`45%` pass threshold) with downloadable A4 PDF Report Cards, and semester routines.'
            ].join('\n');
        }
    },
    {
        id: 'post_likes_notifications',
        title: 'Post, File & Assignment Likes/Votes and Milestone Notifications',
        priority: 92,
        isIdentityOrFounder: false,
        patterns: [
            /\b(?:why\s+(?:didn'?t|did\s+not|don'?t|do\s+not)\s+i\s+(?:get|receive)\s+(?:a\s+)?notification\s+when\s+(?:someone\s+)?(?:liked|upvoted|voted)|(?:does|do)\s+(?:liking|upvoting|downvoting|voting)\s+(?:a\s+)?(?:post|file|assignment)\s+(?:send|trigger|give)|who\s+(?:liked|upvoted|downvoted|voted)\s+(?:a|my)\s+(?:post|file|assignment)|(?:post|file|assignment)\s+(?:like|likes|upvote|upvotes|vote|votes)\s+notification|notification\s+(?:for|on)\s+(?:likes?|upvotes?|votes?)|anonymous\s+vote\s+milestone|multiples?\s+of\s+10|10\s+(?:likes|upvotes|votes)|how\s+do\s+(?:post\s+)?(?:likes?|upvotes?|downvotes?|votes?)\s+work)\b/i,
            /\b(?:like\s+garda\s+kina\s+notification\s+aayena|post\s+like\s+notification\s+kasari\s+aauxa|upvote\s+notification)\b/i
        ],
        factSheet: [
            'Voting tables: post_votes, file_votes, and assignment_votes support +1 (upvote/like) and -1 (downvote/dislike).',
            'No per-like notifications: Individual upvotes or downvotes on posts, library files, or assignments NEVER send one-by-one notifications and never reveal who voted.',
            'Anonymous 10-upvote milestones: A notification is sent ONLY when total upvotes (+1 votes) reach an exact multiple of 10 (10, 20, 30, 40...) for the first time, delivered as an anonymous milestone notification (anonymousVoteMilestone: true, actorId: null).'
        ].join(' '),
        buildReply({ lang }) {
            if (lang === 'romanized_nepali' || lang === 'mixed') {
                return [
                    'Semester Library ma **Posts, Library Files, ra Assignments** ko voting ra notification yesari kam garchha:',
                    '- **No Individual Like Notifications:** Kasैले single upvote (`+1`) wa downvote (`-1`) garda individual notification aaudaina ra vote garne manchhe ko naam pani anonymous hunchha.',
                    '- **Anonymous Milestone Notifications (Every 10 Upvotes):** Tapai ko post, file, wa assignment le **10 ko multiple (`10, 20, 30...` upvotes)** pahilo patak reach garda matra system le anonymous milestone notification (`actorId: null`) pathauxa.',
                    '- **Comment Likes:** Comment ma reaction/like garda chahi author lai notification janchha (5-minute rapid-tap deduplication guard sahit).'
                ].join('\n');
            }
            return [
                'Here is how likes/votes and notifications work on **Posts, Library Files, and Assignments**:',
                '- **No Per-Vote Notifications:** Individual upvotes (`+1`) and downvotes (`-1`) in `post_votes`, `file_votes`, and `assignment_votes` do **not** trigger individual notifications and never expose who voted.',
                '- **Anonymous 10-Upvote Milestones:** You receive a vote notification **only when total upvotes reach a multiple of 10** (`10, 20, 30...`) for the first time (`anonymousVoteMilestone: true`, `actorId: null`).',
                '- **Comment Likes:** Liking a *comment* does notify the comment author, protected by a **5-minute deduplication window** so rapid tapping never spams them (and unliking removes/decrements the notification).'
            ].join('\n');
        }
    },
    {
        id: 'comments_replies_mentions',
        title: 'Comments, Replies, Soft Delete & @kyana Mentions',
        priority: 90,
        isIdentityOrFounder: false,
        patterns: [
            /\b(?:how\s+do\s+(?:comments?|replies|comment\s+notifications?)\s+work|comment\s+(?:delete|deletion|soft\s+delete|placeholder|notification|reaction)|\[comment\s+deleted\]|why\s+does\s+(?:a\s+)?deleted\s+comment\s+say\s+\[?comment\s+deleted\]?|mention(?:ing)?\s+@?kyana\s+in\s+comments?|@kyana)\b/i,
            /\b(?:comment\s+delete\s+garda\s+kina\s+comment\s+deleted\s+dekhauxa|comment\s+notification\s+kasari\s+aauxa)\b/i
        ],
        factSheet: [
            'Root comments notify the post/file/assignment author (unless self-commenting).',
            'Replies notify the target comment author (reply_to_user_id); nested replies flatten under the root parent_comment_id to keep threads clean.',
            'Comment reactions use a 5-minute deduplication guard (isRecentReactionNotification), and unliking removes the actor from the notification group.',
            'Comment deletion rule: If a post comment has active replies (reply_count > 0), deleting it performs a soft delete (sets deleted_at and replaces text with "[Comment deleted]") to preserve the conversation thread. If it has 0 replies, it is permanently hard-deleted.',
            'Tagging @kyana in a post, library file, or assignment comment triggers an automated AI reply from KYANA_AI in the thread.'
        ].join(' '),
        buildReply({ lang }) {
            if (lang === 'romanized_nepali' || lang === 'mixed') {
                return [
                    'Semester Library ma **Comments, Replies, ra `@kyana` Mentions** ko rules:',
                    '- **Notifications:** Root comment garda post/file/assignment author lai notification janchha; reply garda jun comment ma reply gareko ho tesko author (`reply_to_user_id`) lai notification janchha.',
                    '- **Comment Reaction Guard:** Comment like garda **5-minute deduplication guard** lagchha jasle garda like/unlike repeat garda spam hudaina.',
                    '- **Comment Deletion (`[Comment deleted]`):** Yadi comment ma replies chhan bhane delete garda thread na-bigrios bhanera **soft delete** hunchha (`[Comment deleted]` dekhinchha). Replies chhaina (`0` replies) bhane **hard delete** hunchha.',
                    '- **`@kyana` Tagging:** Post, file, wa assignment comment ma `@kyana` lekhera question sodhda Kyana AI le tyahi thread ma automated reply dinchha.'
                ].join('\n');
            }
            return [
                'Here is how **Comments, Replies, Reactions, and `@kyana` Mentions** work across posts, files, and assignments:',
                '- **Comment & Reply Notifications:** Root comments notify the post/file/assignment owner; replies notify the specific user being replied to (`reply_to_user_id`), while flattening deep nesting under the root `parent_comment_id`.',
                '- **5-Minute Reaction Guard:** Liking a comment notifies the author with a **5-minute rapid-tap deduplication window**, and unliking removes or decrements the grouped notification.',
                '- **Soft Delete vs. Hard Delete:** Deleting a post comment that already has replies performs a **soft delete** (sets `deleted_at` and replaces the text with `"[Comment deleted]"`) so child replies stay intact. Comments with **0 replies** are permanently **hard-deleted**.',
                '- **`@kyana` Thread Replies:** Mentioning `@kyana` in any post, note, or assignment comment triggers an automatic threaded reply from **Kyana AI**.'
            ].join('\n');
        }
    },
    {
        id: 'post_reporting_moderation',
        title: 'Post & Comment Reporting and Auto-Moderation',
        priority: 91,
        isIdentityOrFounder: false,
        patterns: [
            /\b(?:how\s+(?:does|do)\s+(?:post|comment)\s+report(?:ing|s)?\s+work|report(?:ing)?\s+a\s+(?:post|comment)|does\s+(?:the\s+)?(?:author|poster|user)\s+get\s+notified\s+when\s+reported|what\s+happens\s+when\s+a\s+post\s+is\s+reported|3\s+(?:open\s+)?reports?)\b/i,
            /\b(?:post\s+report\s+garda\s+notification\s+janchha\s+ki\s+nai|post\s+kasari\s+report\s+garne)\b/i
        ],
        factSheet: [
            'Reporting endpoint: POST /api/posts/:id/report (supports reporting a post or a specific commentId).',
            'Restrictions: You cannot report your own post or comment (HTTP 400), and you cannot submit duplicate open reports on the same item (HTTP 409).',
            'Confidentiality: Zero notifications are sent to the reported author—they are never notified that their post or comment was reported.',
            'Auto-Moderation at 3 Open Reports: When a post accumulates 3 or more open reports (>= 3), it is automatically soft-hidden from Kyana AI knowledge indexing (onPostModerationChanged isHidden: true) pending administrator review.'
        ].join(' '),
        buildReply({ lang }) {
            if (lang === 'romanized_nepali' || lang === 'mixed') {
                return [
                    '**Post ra Comment Reporting** ko lagi Semester Library ma yasto नियम chha:',
                    '- **Confidential Reporting:** Post wa comment report garda author lai **kunai pani notification jadaina** (100% confidential).',
                    '- **Validation Rules:** Aafno post/comment aafai report garna mildaina (`400`) ra euta item ma duplicate open report pathauna mildaina (`409`).',
                    '- **Auto-Protection at 3 Reports:** Kunai post ma **3 wa tyo bhanda badi open reports (`>= 3`)** pugyo bhane admin review nahunjel tyo post Kyana AI ko knowledge index bata automatically soft-hide hunchha.'
                ].join('\n');
            }
            return [
                'Here is how **Post and Comment Reporting** works in Semester Library:',
                '- **Strictly Confidential (Zero Author Notifications):** Reporting a post or comment (`POST /api/posts/:id/report`) sends **no notification** to the reported author.',
                '- **Anti-Abuse Checks:** You cannot report your own content (`400`), and you cannot submit duplicate open reports for the same post or comment (`409`).',
                '- **Automatic Protection at 3 Open Reports:** Once a post reaches **3 or more open reports (`>= 3`)**, it is automatically soft-hidden from Kyana AI\'s campus knowledge index (`isHidden: true`) until an administrator reviews and resolves the reports.'
            ].join('\n');
        }
    },
    {
        id: 'post_creation_editing_deletion',
        title: 'Post Categories, Visibility (students_only), Editing & Deletion',
        priority: 89,
        isIdentityOrFounder: false,
        patterns: [
            /\b(?:who\s+can\s+(?:edit|delete|create)\s+(?:a\s+)?posts?|how\s+to\s+(?:edit|delete|create)\s+(?:a\s+)?post|post\s+(?:categories|visibility|attachments?|limits?)|students_only|students\s+only\s+posts?|can\s+teachers\s+see\s+students\s+only\s+posts?|who\s+can\s+post\s+(?:a\s+)?notice)\b/i,
            /\b(?:post\s+kasari\s+(?:edit|delete)\s+garne|students\s+only\s+post\s+teacher\s+le\s+herda\s+milxa\s+ki\s+nai|notice\s+kasle\s+halna\s+pauxa)\b/i
        ],
        factSheet: [
            'Post Categories: notice (restricted to admin, cr, and teacher), announcement, news, general (no title field allowed), complaints, and feedback.',
            'Visibility Levels: "everyone" (visible to all authenticated users) and "students_only" (strictly visible only to student and cr roles; hidden from teachers and normal admin feeds unless moderation mode is used).',
            'Attachment Limits: Up to 10 images and 5 document attachments per post, maximum 4 MB per file.',
            'Editing & Deletion: Only the post author may edit their post (PUT /api/posts/:id), and only the post author or an admin may delete a post (DELETE /api/posts/:id, which cascades and removes its knowledge index entry).'
        ].join(' '),
        buildReply({ lang }) {
            if (lang === 'romanized_nepali' || lang === 'mixed') {
                return [
                    '**Community Posts** create, edit, ra delete garne rules:',
                    '- **Categories & Notice Permission:** `notice` category ma **`admin`, `cr`, ra `teacher`** le matra post garna pauxan. Aru categories (`general`, `announcement`, `news`, `complaints`, `feedback`) sabai le use garna milchha (`general` post ma title hudaina).',
                    '- **Visibility (`everyone` vs `students_only`):** `students_only` visibility bhayeko post **`student` ra `cr`** le matra dekhchhan—teachers ko feed ma yo strictly hidden hunchha.',
                    '- **Attachment Limits:** Euta post ma maximum **10 images** ra **5 documents** (`<= 4 MB` per file) attach garna milchha.',
                    '- **Edit & Delete:** Post **author** le aafno post edit/delete garna pauxa, ra **`admin`** le kunai pani post delete garna sakchha.'
                ].join('\n');
            }
            return [
                'Here are the rules for **Creating, Editing, and Deleting Posts** in the Community Feed:',
                '- **Post Categories:** Available categories are `notice`, `announcement`, `news`, `general` (body-only, no title), `complaints`, and `feedback`. Only **`admin`, `cr`, and `teacher`** roles can publish `notice` posts.',
                '- **Visibility (`everyone` vs. `students_only`):** Posts set to `students_only` are strictly visible to **`student` and `cr`** accounts and are filtered out of `teacher` feeds (and standard `admin` feeds outside moderation review).',
                '- **Attachments:** Each post supports up to **10 images** and **5 document files** (up to **4 MB** each).',
                '- **Editing & Deletion:** Only the **post author** can edit a post (`PUT /api/posts/:id`), and only the **post author or an `admin`** can delete a post (`DELETE /api/posts/:id`).'
            ].join('\n');
        }
    },
    {
        id: 'messaging_dm_cohort_chat',
        title: 'Direct Messaging (DM), Read Receipts & Cohort Group Chat',
        priority: 91,
        isIdentityOrFounder: false,
        patterns: [
            /\b(?:direct\s+messag(?:e|es|ing)|\bdms?\b|read\s+receipts?|15[\s-]*minutes?\s+edit|edit\s+(?:a\s+)?(?:dm|message)|delete\s+for\s+everyone|delete\s+for\s+me|block(?:ing)?\s+(?:a\s+)?user\s+in\s+(?:dm|chat)|why\s+can'?t\s+i\s+(?:send\s+a\s+dm|message)|cohort\s+chat|mercury|venus|earth|mars\s+chat|pin(?:ning)?\s+(?:a\s+)?message)\b/i,
            /\b(?:dm\s+kasari\s+pathaune|message\s+edit\s+kati\s+time\s+samma\s+milxa|cohort\s+chat\s+ma\s+ko\s+ko\s+hunchha)\b/i
        ],
        factSheet: [
            'Direct Messaging (/api/dm): Both sender and recipient must have active accounts with verification_status = "verified". Blocked user pairs (dm_blocks) cannot message each other.',
            'DM Editing & Deletion: Senders can edit a DM only within 15 minutes of sending (editWindowMinutes: 15). Messages can be deleted "for_me" or "for_everyone" (by sender).',
            'Read Receipts: Opening/reading a conversation (POST /api/dm/conversations/:id/read) monotonically advances last_read_message_id so the other participant sees read status.',
            'DM Privacy & Push: Users can mute conversations and enable hide_lockscreen_preview so push notifications hide message text on lockscreens.',
            'Cohort Group Chat (/api/chat): 4 active cohort rooms (MERCURY, VENUS, EARTH, MARS). Students access their assigned cohort room; teachers access rooms for semesters they teach; admins access all active rooms. Only admin and cr can pin messages. If a message contains @mentions, push notifications go only to the mentioned members.'
        ].join(' '),
        buildReply({ lang }) {
            if (lang === 'romanized_nepali' || lang === 'mixed') {
                return [
                    '**Direct Messaging (DM) ra Cohort Group Chat** ko rules:',
                    '- **Direct Messaging (`/api/dm`):** DM chalauna sender ra receiver dubai ko account **`verified`** hunuparchha. Block gariyeko user (`dm_blocks`) sanga message hudaina.',
                    '- **15-Minute Edit Window & Deletion:** Pathayeko DM **15 minutes bhitra** matra edit garna milchha (`editWindowMinutes: 15`). Delete garda `for_me` wa `for_everyone` choose garna milchha.',
                    '- **Read Receipts & Lockscreen Privacy:** Message herda `last_read_message_id` update hunchha (seen/read receipt). Settings bata conversation mute garna ra `hide_lockscreen_preview` on garna milchha.',
                    '- **Cohort Chat (`/api/chat`):** BIT cohorts (`MERCURY`, `VENUS`, `EARTH`, `MARS`) ma students le aafno cohort room, teachers le padhaune semester ko room, ra admins le sabai rooms access garchhan. **`admin` ra `cr`** le message pin garna pauxan, ra `@mention` garda mentioned user lai matra push notification janchha.'
                ].join('\n');
            }
            return [
                'Here is how **Direct Messaging (DM)** and **Cohort Group Chat** work:',
                '- **Direct Messaging Eligibility (`/api/dm`):** Both users must have an active account with `verification_status = "verified"`, and neither user can have blocked the other (`dm_blocks`).',
                '- **15-Minute Edit Window & Deletion:** You can edit a sent DM within **15 minutes** (`editWindowMinutes: 15`), and delete messages either **for yourself (`for_me`)** or **for everyone (`for_everyone`)**.',
                '- **Read Receipts & Privacy:** Viewing a thread (`POST /api/dm/conversations/:id/read`) advances `last_read_message_id` monotonically for read receipts. You can mute conversations or enable `hide_lockscreen_preview` to mask message text on lockscreen push alerts.',
                '- **Cohort Group Chat (`/api/chat`):** Active cohorts (`MERCURY`, `VENUS`, `EARTH`, `MARS`) are scoped so students join their assigned cohort, teachers join rooms for semesters they teach, and admins access all active rooms. **`admin` and `cr`** roles can pin messages, and using `@mentions` sends push alerts **only to the mentioned members**.'
            ].join('\n');
        }
    },
    {
        id: 'attendance_rules_permissions',
        title: 'Attendance Visibility, 24-Hour Teacher Edit Window & Admin Corrections',
        priority: 93,
        isIdentityOrFounder: false,
        patterns: [
            /\b(?:attendance\s+(?:is\s+)?(?:edit\s+window|lock(?:ed)?|rules?|permissions?|privacy|visibility|notification|correction|audit)|(?:lock(?:ed)?|edit)\s+after\s+24[\s-]*hours?|24[\s-]*hours?\s+(?:attendance|edit\s+window|window)|why\s+can'?t\s+(?:a\s+|my\s+)?teacher\s+(?:edit|change|update)\s+attendance|how\s+(?:do\s+i|to)\s+(?:check|view|mark|edit)\s+(?:my\s+)?attendance|can\s+(?:other\s+)?students?\s+see\s+(?:my|other\s+students?'?)\s+attendance|does\s+attendance\s+send\s+notifications?)\b/i,
            /\b(?:attendance\s+kasari\s+herne|teacher\s+le\s+attendance\s+kati\s+time\s+samma\s+edit\s+garna\s+milxa|24\s+ghanta\s+pachi\s+attendance\s+edit)\b/i
        ],
        factSheet: [
            'Student Privacy (GET /api/attendance/me): Students and CRs can view ONLY their own attendance percentages and session history. Cross-student attendance lookups are strictly blocked. Marking attendance sends zero push notifications.',
            'Teacher Recording & 24-Hour Edit Window: Teachers can record attendance only for their assigned active BIT subjects, for non-future Nepal dates, and must mark the complete active cohort roster. Teachers can edit a submitted session ONLY within 24 hours (EDIT_WINDOW_HOURS = 24) of submitted_at.',
            'Post-24h Admin Correction: After 24 hours, the session is locked for teachers (HTTP 403). Only an Administrator can modify it via POST /api/attendance/sessions/:id/admin-correct with a mandatory reason (>= 3 characters), which records full before/after diffs in attendance_audit_logs and admin_audit_logs and queues a SHA-256 canonical snapshot to Google Drive.'
        ].join(' '),
        buildReply({ lang }) {
            if (lang === 'romanized_nepali' || lang === 'mixed') {
                return [
                    'Semester Library ma **Attendance Rules, Privacy, ra 24-Hour Edit Window** yesari kam garchha:',
                    '- **Student Privacy (`/api/attendance/me`):** Students ra CRs le **aafno matra** attendance herna pauxan (aru student ko herna mildaina). Attendance mark huda kunai push notification aaudaina.',
                    '- **Teacher 24-Hour Edit Window:** Assigned subject teacher le non-future Nepal date ko lagi purai cohort roster ko attendance mark garna sakchhan, ra submit gareko **24 ghanta (`24 hours`) bhitra matra** edit garna milchha.',
                    '- **After 24 Hours (Admin Correction Only):** 24 hours pachi teacher ko lagi session lock hunchha (`403`). Tespachi **`admin`** le matra mandatory reason (`>= 3` chars) diyera correction garna sakchha, jun `attendance_audit_logs` ra Google Drive SHA-256 backup snapshot ma record hunchha.'
                ].join('\n');
            }
            return [
                'Here is how **Attendance Visibility, Permissions, and the 24-Hour Edit Window** work:',
                '- **Student Privacy (`GET /api/attendance/me`):** Students and CRs can view **only their own** subject-wise attendance and session logs (or ask me *"What is my attendance?"*). No push notification is sent when attendance is marked.',
                '- **Teacher Recording & 24-Hour Edit Window:** Assigned teachers can mark attendance for active subjects on non-future Nepal dates across the full cohort roster, and may edit a submitted session **only within 24 hours (`EDIT_WINDOW_HOURS = 24`)** of submission.',
                '- **Post-24h Administrator Corrections:** Once 24 hours pass, the session locks for teachers (`403`). Any later change requires an **Administrator correction** (`POST /api/attendance/sessions/:id/admin-correct`) with a mandatory audit reason (`>= 3` characters), logged to `attendance_audit_logs` and backed up via a SHA-256 snapshot to Google Drive.'
            ].join('\n');
        }
    },
    {
        id: 'marks_results_privacy',
        title: 'Marks & Exam Results Privacy, Draft Hiding & PDF Report Cards',
        priority: 93,
        isIdentityOrFounder: false,
        patterns: [
            /\b(?:(?:marks?|results?|grades?|report\s*card)\s+(?:are\s+)?(?:not\s+showing|not\s+visible|privacy|visibility|rules?|draft|published|pass\s+marks?|pass\s+percentage|threshold|download|pdf)|why\s+(?:can'?t\s+i\s+see|are)\s+my\s+(?:exam\s+)?(?:marks?|results?)|draft\s+(?:marks?|results?|exams?)|how\s+(?:do\s+i|to)\s+(?:check|view|download)\s+(?:my\s+)?(?:marks?|results?|report\s*card)|can\s+others\s+see\s+my\s+(?:marks?|results?))\b/i,
            /\b(?:marks\s+kina\s+dekhidaina|result\s+kasari\s+herne|report\s+card\s+kasari\s+download\s+garne|pass\s+percentage\s+kati\s+ho)\b/i
        ],
        factSheet: [
            'Results Privacy (GET /api/results/me): Students and CRs can view ONLY their own exam marks, and ONLY for exams where status = "published". Draft exams (status = "draft") are strictly filtered out at the SQL level.',
            'Exam Types & Pass Threshold: Supported exam types are Mid-Term Exam, Pre-Board Exam, and Final Exam. A subject score is marked passed when percentage >= 45% (and not absent).',
            'PDF Report Card (GET /api/results/me/report-card): Students can download an official A4 PDF Report Card for any semester that has at least 1 published exam.'
        ].join(' '),
        buildReply({ lang }) {
            if (lang === 'romanized_nepali' || lang === 'mixed') {
                return [
                    '**Exam Marks, Results Privacy, ra PDF Report Card** ko rules:',
                    '- **Strict Privacy & Draft Hiding (`/api/results/me`):** Students ra CRs le **aafno matra** result herna pauxan. Teacher le marks enter garera **`published`** nagare samma (`status = "draft"` huda) SQL level mai marks lukaiyeko hunchha, tesaile draft marks student portal ma dekhidaina.',
                    '- **Exam Types & Pass Marks:** `Mid-Term Exam`, `Pre-Board Exam`, ra `Final Exam` ko marks publish hunchha, jasma pass threshold **45% (`percentage >= 45%`)** ho.',
                    '- **A4 PDF Report Card:** Semester ma kamti ma **1 wota published exam** bhayepachi tapai le **Results** page bata official **A4 PDF Report Card** (`GET /api/results/me/report-card`) download garna saknuhunchha.'
                ].join('\n');
            }
            return [
                'Here is how **Marks, Results Privacy, and PDF Report Cards** work in Semester Library:',
                '- **Student Privacy & Draft Hiding (`GET /api/results/me`):** You can view **only your own** results, and **only after the exam is marked `published`**. While a teacher is still entering scores in `draft` status, those marks are hidden at the database query level.',
                '- **Exam Types & 45% Pass Threshold:** Results cover **Mid-Term Exam**, **Pre-Board Exam**, and **Final Exam** sessions, with a pass threshold of **45% (`percentage >= 45%`)**.',
                '- **A4 PDF Report Card:** Once at least **1 exam is published** for a semester, you can download your formatted **A4 PDF Report Card** (`GET /api/results/me/report-card`) directly from the Results view.'
            ].join('\n');
        }
    },
    {
        id: 'roles_permissions',
        title: 'Teacher, Student, CR & Admin Roles and Permissions',
        priority: 90,
        isIdentityOrFounder: false,
        patterns: [
            /\b(?:(?:role|roles|permission|permissions)\s+(?:in|of|for|matrix)|difference\s+between\s+(?:student|cr|class\s+representative|teacher|admin)|what\s+can\s+(?:a\s+)?(?:cr|class\s+representative|teacher|admin|student)\s+do|who\s+can\s+(?:promote|demote|verify|suspend)\s+(?:users?|students?|cr))\b/i,
            /\b(?:cr\s+le\s+k\s+k\s+garna\s+milxa|teacher\s+ra\s+cr\s+ko\s+permission|admin\s+le\s+k\s+garna\s+milxa)\b/i
        ],
        factSheet: [
            'Semester Library has 4 roles: student, cr (Class Representative), teacher, and admin.',
            'student: Browse/download Library notes, ask Kyana AI, submit Code Lab solutions, view own attendance and published marks, post in community feed (everyone or students_only), and use assigned Cohort Chat and verified DMs.',
            'cr: All student permissions PLUS publish official "notice" posts, create/edit/delete class routines (/api/routines), and pin messages in Cohort Chat.',
            'teacher: Upload/edit/delete Library chapters and notes for assigned subjects (<= 250 MB), create/grade Code Lab assignments and run 0.85 Jaccard similarity checks, record/edit cohort attendance within 24 hours, enter/publish exam marks, publish "notice" posts, and access taught semester Cohort Chats (cannot view students_only posts).',
            'admin: Full platform administration, user verification, role promotion/demotion (student <-> cr), teacher onboarding/subject assignment, post-24h attendance corrections with mandatory audit reason, and content moderation.'
        ].join(' '),
        buildReply({ lang }) {
            if (lang === 'romanized_nepali' || lang === 'mixed') {
                return [
                    'Semester Library ma **4 wota roles (`student`, `cr`, `teacher`, `admin`)** ko permissions yesari chhutiyeko chha:',
                    '- **`student`:** Library notes padhne/download garne, Kyana AI chalaune, Code Lab submit garne, aafno attendance ra published marks herne, feed (`everyone` / `students_only`) ra cohort chat/DM chalaune.',
                    '- **`cr` (Class Representative):** Student ko sabai access + official **`notice` posts** halne, **Class Routine** (`POST/PUT/DELETE /api/routines`) update garne, ra Cohort Chat ma **message pin** garne.',
                    '- **`teacher`:** Assigned subjects ko **Library notes upload/edit/delete** garne (`<= 250 MB`), **Code Lab** assignments banaune/grade release garne, **24-hour window** bhitra attendance mark/edit garne, ra **exam marks** enter/publish garne (`students_only` posts herna mildaina).',
                    '- **`admin`:** Account verification, suspension, **`student <-> cr` promotion/demotion**, teacher onboarding, **24h pachi ko attendance audit correction**, ra reported content moderation garne.'
                ].join('\n');
            }
            return [
                'Semester Library enforces role-based access across **4 roles (`student`, `cr`, `teacher`, `admin`)**:',
                '- **`student`:** Read/download Library notes, use Kyana AI, submit Code Lab solutions, view personal attendance and published results, create community posts (`everyone` or `students_only`), and use assigned Cohort Chat and verified DMs.',
                '- **`cr` (Class Representative):** All `student` capabilities plus publishing official **`notice`** posts, managing **Class Routines** (`/api/routines`), and **pinning messages** in Cohort Chat.',
                '- **`teacher`:** Upload/edit/delete **Library chapters and notes** for assigned subjects (`<= 250 MB`), create and grade **Code Lab assignments** (including similarity checks), mark/edit **attendance within 24 hours**, and enter/publish **exam results** (cannot view `students_only` posts).',
                '- **`admin`:** Full governance including user verification, **`student <-> cr` promotion/demotion**, teacher subject assignments, **post-24h attendance corrections** (with mandatory audit reason), and moderation.'
            ].join('\n');
        }
    },
    {
        id: 'file_upload_download_library',
        title: 'Library Note Uploads, File Size Limits & Download Rules',
        priority: 90,
        isIdentityOrFounder: false,
        patterns: [
            /\b(?:(?:who\s+can|can\s+students?|how\s+to)\s+upload\s+(?:notes?|files?|pdfs?|study\s+materials?)|file\s+(?:upload|download|size)\s+(?:limit|rules?|permissions?)|250\s*mb|blocked\s+file\s+(?:types?|extensions?)|why\s+can'?t\s+i\s+upload\s+(?:a\s+)?(?:file|note|pdf))\b/i,
            /\b(?:student\s+le\s+note\s+upload\s+garna\s+milxa\s+ki\s+nai|note\s+kasari\s+upload\s+garne|file\s+upload\s+limit\s+kati\s+ho)\b/i
        ],
        factSheet: [
            'Library Upload Permission (POST /api/files): Only admin and teacher roles (for their assigned subjects) can create chapters or upload, edit, and delete Library study files. Students and CRs receive HTTP 403 if they attempt to upload Library notes.',
            'File Size & Security Rules: Maximum Library file size is 250 MB (stored in Cloudflare R2, or inline PostgreSQL fallback up to 25 MB). Executable and active script extensions (.html, .htm, .svg, .js, .mjs, .cjs, .exe, .bat, .cmd, .sh, .php) are strictly blocked.',
            'Student Note Sharing Alternative: While students/CRs cannot upload directly to the official Subject Library, they can attach up to 5 documents (<= 4 MB each) to a Community Feed post or ask their subject teacher/admin to publish the material.'
        ].join(' '),
        buildReply({ lang }) {
            if (lang === 'romanized_nepali' || lang === 'mixed') {
                return [
                    '**Academic Library File Upload ra Download** ko rules:',
                    '- **Who Can Upload (`/api/files`):** Official Subject Library (`Semester -> Subject -> Chapter -> Notes`) ma **`admin` ra assigned subject `teacher`** le matra notes/files upload, edit, wa delete garna pauxan. Students ra CRs le library ma direct upload garna mildaina (`403`).',
                    '- **Size Limit & Blocked Extensions:** Library file upload limit **250 MB** samma chha, ra security ko lagi `.html`, `.svg`, `.js`, `.exe`, `.bat`, `.sh`, `.php` jasta active/executable files blocked chhan.',
                    '- **How Students Can Share Notes:** Students le Community Feed post ma **5 wota samma documents (`<= 4 MB` each)** attach garera share garna sakchhan wa aafno subject teacher lai Library ma upload garidina request garna sakchhan.'
                ].join('\n');
            }
            return [
                'Here is how **Library File Uploads and Downloads** work in Semester Library:',
                '- **Upload Permissions (`POST /api/files`):** Only **`admin`** and assigned **`teacher`** accounts can create chapters or upload, edit, and delete files in the official Subject Library. `student` and `cr` accounts have read/download access (`GET /api/files/:id/download`) and cannot upload directly to the Library (`403`).',
                '- **File Size & Security Limits:** Library uploads support files up to **250 MB** (stored in Cloudflare R2), and block dangerous/executable extensions (`.html`, `.htm`, `.svg`, `.js`, `.mjs`, `.cjs`, `.exe`, `.bat`, `.cmd`, `.sh`, `.php`).',
                '- **Sharing Notes as a Student:** You can share study documents in the **Community Feed** (up to **5 document attachments, `<= 4 MB` each** per post) or share the file with your subject teacher to publish in the Subject Library.'
            ].join('\n');
        }
    },
    {
        id: 'assignments_code_lab',
        title: 'Code Lab Assignments, Submissions, Grade Release & Similarity Check',
        priority: 90,
        isIdentityOrFounder: false,
        patterns: [
            /\b(?:code\s*lab|coding\s+assignments?|how\s+to\s+submit\s+(?:an?\s+)?assignment|assignment\s+submission\s+(?:limit|rules?|grades?)|why\s+can'?t\s+i\s+see\s+my\s+(?:assignment\s+)?grade|grade\s+release|similarity\s+check(?:er)?|jaccard|plagiarism\s+check)\b/i,
            /\b(?:code\s+lab\s+ma\s+assignment\s+kasari\s+submit\s+garne|assignment\s+ko\s+marks\s+kina\s+dekhidaina)\b/i
        ],
        factSheet: [
            'Code Lab Submissions (POST /api/code-lab/questions/:questionId/submissions): Students submit code per question (rate-limited to 10 submissions per minute per student), which is automatically executed against test cases.',
            'Grade Visibility (submission_grades): Teacher scores and written feedback remain hidden from students until the teacher explicitly sets released = true (POST /api/code-lab/assignments/:id/grades/release).',
            'Code Similarity Checker: Teachers and admins can run a token-bigram Jaccard similarity check (GET /api/code-lab/questions/:questionId/similarity, default threshold 0.85) across each student\'s latest submission to detect copied code.'
        ].join(' '),
        buildReply({ lang }) {
            if (lang === 'romanized_nepali' || lang === 'mixed') {
                return [
                    '**Code Lab Assignments ra Submissions** yesari kam garchha:',
                    '- **Submitting Code:** Students le harek question ma code lekhera test cases run garna ra submit garna sakchhan (rate limit: **10 submissions per minute**).',
                    '- **Grade & Feedback Visibility:** Teacher le check gareko grade ra remarks (`submission_grades`) teacher le **`Release Grades` (`released = true`)** nagare samma student lai dekhidaina.',
                    '- **Code Similarity Check:** Teachers ra admins sanga token-bigram **Jaccard similarity checker** (`0.85` default threshold) hunchha jasle students ko latest submissions compare garera copy bhayeko code detect garchha.'
                ].join('\n');
            }
            return [
                'Here is how **Code Lab Assignments and Grading** work:',
                '- **Code Submissions:** Students submit solutions per question (`POST /api/code-lab/questions/:questionId/submissions`, rate-limited to **10 submissions per minute**), which are evaluated against automated test cases (`passed`, `partial`, `failed`, `compile_error`, `runtime_error`, `tle`).',
                '- **Controlled Grade Release:** Teacher grades and remarks in `submission_grades` stay hidden from students until the teacher explicitly releases grades (**`released = true`**).',
                '- **Code Similarity Detection:** Teachers and admins can run a token-bigram **Jaccard similarity analysis** (default threshold **`0.85`**) across latest submissions to identify potential code copying.'
            ].join('\n');
        }
    },
    {
        id: 'profile_account_management',
        title: 'Profile Editing, Cohort/Semester Lock, Password Reset & Account Deletion',
        priority: 91,
        isIdentityOrFounder: false,
        patterns: [
            /\b(?:how\s+(?:do\s+i|to|can\s+i)\s+(?:edit|update|change)\s+(?:my\s+)?(?:profile|username|bio|avatar|semester|password)|why\s+can'?t\s+i\s+change\s+my\s+semester|cannot\s+change\s+semester|delete\s+(?:my\s+)?account|account\s+deletion|change\s+password|revoke\s+sessions?)\b/i,
            /\b(?:semester\s+kina\s+change\s+hudaina|profile\s+kasari\s+edit\s+garne|account\s+kasari\s+delete\s+garne|password\s+kasari\s+change\s+garne)\b/i
        ],
        factSheet: [
            'Editable Profile Fields (PUT /api/profile): Users can update name, username (3–30 alphanumeric/underscore/dot characters), bio (up to 300 characters), githubUrl, linkedinUrl, gender, and avatar.',
            'Semester & Department Lock: Students and CRs CANNOT change their semester once assigned to an active cohort_id (HTTP 403: "Your semester is managed by your assigned cohort. Contact an admin to change it."), and cannot self-edit their department.',
            'Password Change (POST /api/change-password): Requires current password and a new password (>= 8 characters with uppercase, lowercase, and number), and immediately revokes all other active web sessions and mobile tokens.',
            'Account Deletion (POST/DELETE /api/account/delete or /api/account/delete-request): Requires current password confirmation, revokes all sessions, removes avatars from R2, and permanently deletes the user account and personal data.'
        ].join(' '),
        buildReply({ lang }) {
            if (lang === 'romanized_nepali' || lang === 'mixed') {
                return [
                    '**Profile Editing, Semester Lock, ra Account Management** ko rules:',
                    '- **Editable Fields (`/api/profile`):** Tapai le `name`, `username` (`3–30` chars), `bio` (`<= 300` chars), `githubUrl`, `linkedinUrl`, `gender`, ra profile photo (`avatar`) update garna saknuhunchha.',
                    '- **Why Semester Cannot Be Changed (`403`):** Active cohort (`cohort_id`) ma assign bhayepachi student wa CR le aafai `semester` wa `department` change garna mildaina. Semester update garna **Admin** lai contact garnuparchha.',
                    '- **Password Change (`/api/change-password`):** Current password diyera naya password rakhda aru sabai devices ko active sessions ra mobile tokens automatically logout/revoke hunchha.',
                    '- **Account Deletion (`/api/account/delete`):** Current password confirm garera account delete garda tapai ko personal data ra sessions permanently delete hunchha.'
                ].join('\n');
            }
            return [
                'Here is how **Profile Editing, Semester Locks, Password Changes, and Account Deletion** work:',
                '- **Editable Profile Fields (`PUT /api/profile`):** You can update your `name`, `username` (`3–30` characters), `bio` (`<= 300` characters), `githubUrl`, `linkedinUrl`, `gender`, and `avatar`.',
                '- **Cohort Semester Lock (`403`):** Once a student or CR is assigned to an active `cohort_id`, **you cannot self-change your `semester` or `department`**. Your semester is tied to your cohort—contact an **Administrator** if your cohort/semester needs reassignment.',
                '- **Password Security (`POST /api/change-password`):** Changing your password requires your current password and automatically **revokes all other active web sessions and mobile tokens**.',
                '- **Permanent Account Deletion (`/api/account/delete`):** Confirming your current password permanently deletes your account, revokes all sessions, and purges your personal data.'
            ].join('\n');
        }
    },
    {
        id: 'feature_overview',
        title: 'How to Use Semester Library Features & Troubleshooting',
        priority: 82,
        isIdentityOrFounder: false,
        patterns: [
            /\b(?:how\s+to\s+use\s+semester\s+library|semester\s+library\s+(?:guide|tutorial|help|faq|faqs|support|troubleshooting)|help\s+me\s+use\s+(?:this\s+app|semester\s+library)|how\s+do\s+i\s+study\s+with\s+kyana|split[\s-]*screen\s+ai|ask\s+kyana\s+ai\s+button)\b/i,
            /\b(?:semester\s+library\s+kasari\s+chalaune|app\s+kasari\s+use\s+garne)\b/i
        ],
        factSheet: [
            'Library & Split-Screen AI: Open Library -> select Semester (1–8) -> Subject -> Chapter -> Note, then click "Ask Kyana AI" to open a side-by-side AI tutor grounded in that specific document.',
            'Common Troubleshooting: (1) Unverified accounts cannot send DMs until verified by an admin; (2) Post likes only notify on multiples of 10; (3) Draft exam marks stay hidden until published; (4) Attendance locks for teachers after 24 hours; (5) Cohort-assigned students must ask an admin to change their semester.'
        ].join(' '),
        buildReply({ lang }) {
            if (lang === 'romanized_nepali' || lang === 'mixed') {
                return [
                    '**Semester Library Usage Guide & Quick Troubleshooting:**',
                    '- **Study Notes & Split-Screen AI:** **Library** ma gayera `Semester -> Subject -> Chapter -> Note` kholuhos ra **"Ask Kyana AI"** thichera PDF padhdai side-by-side Kyana sanga sodhnuhos.',
                    '- **Quick Troubleshooting:**',
                    '  - **DM chalena?** Account `verified` hunuparchha ra sent message **15 minutes** bhitra matra edit hunchha.',
                    '  - **Post like ko notification aayena?** Upvotes le **10 ko multiple (`10, 20, 30...`)** pugda matra anonymous milestone notification pathauxa.',
                    '  - **Marks dekhiena?** Teacher le exam `published` nagare samma (`draft` huda) marks hidden hunchha.',
                    '  - **Attendance edit bhayena?** Teacher ko edit window **24 hours** ko hunchha; tespachi Admin correction chahinchha.',
                    '  - **Semester change bhayena?** Active cohort ma bhayeko student ko semester Admin le matra change garna milchha.'
                ].join('\n');
            }
            return [
                'Here is a quick guide to using **Semester Library** and resolving common issues:',
                '- **Studying with Library & Kyana AI:** Browse `Semester -> Subject -> Chapter -> Note` to preview or download materials, or click **"Ask Kyana AI"** inside any PDF/note for split-screen tutoring grounded in that file.',
                '- **Common Troubleshooting:**',
                '  - **Can\'t send a DM or edit a message?** Accounts must be `verified` by an admin to use DMs, and sent messages can only be edited within **15 minutes**.',
                '  - **No notification when someone liked your post?** Post/file/assignment upvotes only send **anonymous milestone notifications at multiples of 10** (`10, 20, 30...`).',
                '  - **Marks not visible yet?** Exam scores stay hidden while in `draft` status and appear immediately once published (`45%` pass threshold).',
                '  - **Teacher can\'t edit attendance?** Attendance sessions lock **24 hours** after submission and require an **Admin correction** with an audit reason afterward.',
                '  - **Can\'t change your semester or upload Library notes?** Cohort-assigned semesters are managed by **Admins**, and Subject Library uploads (`<= 250 MB`) are restricted to **assigned Teachers and Admins**.'
            ].join('\n');
        }
    }
]);

function normalizeProductText(message = '') {
    return String(message || '').replace(/\s+/g, ' ').trim();
}

/**
 * Evaluates whether a user message is asking a Semester Library / Kyana AI
 * product knowledge, identity, feature, FAQ, permission, or troubleshooting question.
 */
function isProductKnowledgeQuery(message, history = [], academicContext = null) {
    const clean = normalizeProductText(message);
    const noMatch = { matched: false, primaryTopic: null, topics: [] };
    if (!clean) return noMatch;

    // 1. Never intercept smuggled off-topic requests (e.g. recipes, movies, politics).
    if (STRICT_OFF_TOPIC_PATTERN && STRICT_OFF_TOPIC_PATTERN.test(clean)) {
        return noMatch;
    }

    // 2. Never intercept cross-student privacy violations (let chat-security block them).
    if (isOtherStudentDataRequest && isOtherStudentDataRequest(clean, academicContext).blocked) {
        return noMatch;
    }

    // 3. Do not hijack live personal data queries ("what is my attendance", "show my marks")
    // unless the user is explicitly asking a how-to, why, permission, or rule question.
    if (LIVE_PERSONAL_OR_ACADEMIC_DATA_QUERY.test(clean) && !EXPLICIT_PRODUCT_HELP_FRAMING.test(clean)) {
        return noMatch;
    }

    const matchedTopics = [];
    for (const topic of PRODUCT_KNOWLEDGE_TOPICS) {
        if (topic.patterns.some((rx) => rx.test(clean))) {
            matchedTopics.push(topic);
        }
    }

    if (matchedTopics.length === 0) {
        return noMatch;
    }

    matchedTopics.sort((a, b) => b.priority - a.priority);
    const primary = matchedTopics[0];

    return {
        matched: true,
        primaryTopic: primary.id,
        topics: matchedTopics.map((t) => t.id),
        isIdentityOrFounder: Boolean(primary.isIdentityOrFounder),
        confidence: matchedTopics.length > 1 ? 0.96 : 0.92
    };
}

/**
 * Resolves a verified, deterministic product knowledge response and grounding factSheet.
 */
function resolveProductKnowledge(message, options = {}) {
    const clean = normalizeProductText(message);
    const {
        history = [],
        academicContext = null,
        chatMode = 'roast',
        topic = null,
        topicId = null
    } = options || {};

    const requestedTopicId = topicId || topic;
    const lang = detectLanguage(clean);
    let selectedTopics = [];

    if (requestedTopicId) {
        const byId = PRODUCT_KNOWLEDGE_TOPICS.find((t) => t.id === requestedTopicId);
        if (byId) selectedTopics.push(byId);
    }

    if (selectedTopics.length === 0) {
        const match = isProductKnowledgeQuery(clean, history, academicContext);
        if (match && match.matched) {
            selectedTopics = match.topics
                .map((id) => PRODUCT_KNOWLEDGE_TOPICS.find((t) => t.id === id))
                .filter(Boolean);
        }
    }

    if (selectedTopics.length === 0) {
        // Fallback if called directly via tool with a generic product query
        const fallback = PRODUCT_KNOWLEDGE_TOPICS.find((t) => t.id === 'semester_library_identity');
        selectedTopics = fallback ? [fallback] : [];
    }

    const topSlices = selectedTopics.slice(0, 2);
    const replyText = topSlices.map((t) => t.buildReply({ lang, academicContext, chatMode })).join('\n\n');
    const topicIds = topSlices.map((t) => t.id);
    const factParts = [
        `Semester Library (${SEMESTER_LIBRARY_IDENTITY.institution}, ${SEMESTER_LIBRARY_IDENTITY.program}, ${SEMESTER_LIBRARY_IDENTITY.semesters}) was founded and developed by ${SEMESTER_LIBRARY_IDENTITY.founderAndDeveloper}.`,
        `Kyana AI stands for ${KYANA_AI_IDENTITY.fullForm}.`,
        ...topSlices.map((t) => t.factSheet)
    ];

    return {
        matched: selectedTopics.length > 0,
        primaryTopic: topSlices[0]?.id || 'semester_library_identity',
        topics: topicIds,
        matchedTopics: topicIds,
        title: topSlices[0]?.title || 'Semester Library Product Guide',
        answer: replyText,
        reply: replyText,
        factSheet: factParts.join(' '),
        sourceLabel: 'Semester Library Product Guide'
    };
}

module.exports = {
    PRODUCT_KNOWLEDGE_VERSION,
    SEMESTER_LIBRARY_IDENTITY,
    KYANA_AI_IDENTITY,
    PRODUCT_KNOWLEDGE_TOPICS,
    isProductKnowledgeQuery,
    resolveProductKnowledge
};
