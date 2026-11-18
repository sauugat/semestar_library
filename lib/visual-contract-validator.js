/**
 * Kyana Academic Visualization Contract Validator (`kyana.visual.v1` / `v2`)
 * Validates visualization payloads against the strict 18-engine registry schemas,
 * enforces bounds (64 KB ceiling, array length limits), referential integrity for graphs,
 * prototype pollution protection, and prevents arbitrary code execution.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KyanaVisualValidator = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

const MAX_PAYLOAD_BYTES = 65536; // 64 KB limit

function getByteLength(str) {
  if (typeof str !== 'string') return 0;
  if (typeof Buffer !== 'undefined' && typeof Buffer.byteLength === 'function') {
    return Buffer.byteLength(str, 'utf8');
  }
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str).length;
  }
  return str.length;
}

const ALLOWED_VERSIONS = new Set(['kyana.visual.v1', 'kyana.visual.v2']);

const ALLOWED_MODES = new Set([
  'static',
  'interactive',
  'animated',
  'simulation',
  'execution'
]);

const ALLOWED_ENGINES = new Set([
  'algo_anim',
  'dsa_linear',
  'dsa_tree',
  'dsa_graph',
  'mem_ptr',
  'logic_sim',
  'truth_table',
  'num_sim',
  'os_sim',
  'db_rel',
  'sql_exec',
  'net_proto',
  'net_subnet',
  'uml_arch',
  'cg_trans',
  'web_dom',
  'ai_search',
  'compiler_run'
]);

// Dangerous pattern check for executable HTML/JS, event handlers, protocols, and prototype keys
const DANGEROUS_PATTERNS = [
  /<script\b/i,
  /<\/script>/i,
  /javascript\s*:/i,
  /vbscript\s*:/i,
  /data\s*:\s*text\/html/i,
  /\bon[a-z]{2,}\s*=/i,
  /\beval\s*\(/i,
  /new\s+Function\s*\(/i,
  /<iframe\b/i,
  /<object\b/i,
  /<embed\b/i
];

function containsPrototypePollution(raw) {
  if (typeof raw === 'string') {
    return /"__proto__"|"constructor"|"prototype"/i.test(raw);
  }
  return false;
}

function hasUnsafePrototypes(obj, seen = new Set()) {
  if (!obj || typeof obj !== 'object') return false;
  if (seen.has(obj)) return false;
  seen.add(obj);

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (hasUnsafePrototypes(item, seen)) return true;
    }
    return false;
  }

  const keys = Object.getOwnPropertyNames(obj);
  for (const k of keys) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
      return true;
    }
    if (hasUnsafePrototypes(obj[k], seen)) {
      return true;
    }
  }
  return false;
}

/**
 * Validates the dedicated engine payload based on engine ID.
 */
function validateEngineData(engine, data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, errors: ['Engine data must be a non-null object.'] };
  }

  switch (engine) {
    case 'algo_anim': {
      const allowedAlgos = [
        'binary_search', 'linear_search', 'bubble_sort',
        'selection_sort', 'insertion_sort', 'merge_sort', 'quick_sort'
      ];
      if (!allowedAlgos.includes(data.algorithm)) {
        errors.push(`algo_anim: 'algorithm' must be one of [${allowedAlgos.join(', ')}].`);
      }
      if (!Array.isArray(data.initialArray)) {
        errors.push("algo_anim: 'initialArray' must be an array.");
      } else {
        if (data.initialArray.length < 2 || data.initialArray.length > 20) {
          errors.push('algo_anim: initialArray length must be between 2 and 20.');
        }
        for (let i = 0; i < data.initialArray.length; i++) {
          const val = data.initialArray[i];
          if (typeof val !== 'number' || !Number.isFinite(val) || val < -999 || val > 9999) {
            errors.push(`algo_anim: array elements must be finite numbers between -999 and 9999 (index ${i} is ${val}).`);
          }
        }
      }
      if (data.algorithm === 'binary_search' || data.algorithm === 'linear_search') {
        if (typeof data.target !== 'number' || !Number.isFinite(data.target)) {
          errors.push("algo_anim: search algorithms require a valid numeric 'target'.");
        }
      }
      break;
    }

    case 'dsa_linear': {
      const allowedStructures = ['stack', 'queue', 'singly_linked_list', 'doubly_linked_list', 'circular_linked_list'];
      if (!allowedStructures.includes(data.structure)) {
        errors.push(`dsa_linear: 'structure' must be one of [${allowedStructures.join(', ')}].`);
      }
      if (data.capacity !== undefined) {
        if (typeof data.capacity !== 'number' || data.capacity < 1 || data.capacity > 15) {
          errors.push('dsa_linear: capacity must be an integer between 1 and 15.');
        }
      }
      if (!Array.isArray(data.operations) || data.operations.length === 0 || data.operations.length > 20) {
        errors.push('dsa_linear: operations must be an array of 1 to 20 operations.');
      } else {
        const allowedOps = ['push', 'pop', 'peek', 'enqueue', 'dequeue', 'insert_head', 'insert_tail', 'delete_head', 'delete_val'];
        data.operations.forEach((opObj, idx) => {
          if (!opObj || typeof opObj !== 'object' || !allowedOps.includes(opObj.op)) {
            errors.push(`dsa_linear: operation at index ${idx} is invalid.`);
          }
        });
      }
      break;
    }

    case 'dsa_tree': {
      const allowedTreeTypes = ['binary_tree', 'bst', 'avl'];
      if (!allowedTreeTypes.includes(data.treeType)) {
        errors.push(`dsa_tree: 'treeType' must be one of [${allowedTreeTypes.join(', ')}].`);
      }
      if (!Array.isArray(data.nodes) || data.nodes.length === 0 || data.nodes.length > 25) {
        errors.push('dsa_tree: nodes must be an array of 1 to 25 nodes.');
      } else {
        const nodeIds = new Set();
        data.nodes.forEach((n, idx) => {
          if (!n || typeof n !== 'object' || !n.id || typeof n.id !== 'string') {
            errors.push(`dsa_tree: node at index ${idx} must have a valid string id.`);
          } else {
            if (nodeIds.has(n.id)) {
              errors.push(`dsa_tree: duplicate node id '${n.id}'.`);
            }
            nodeIds.add(n.id);
          }
        });

        // Referential integrity and cycle prevention
        const visited = new Set();
        const inDegree = new Map();
        nodeIds.forEach(id => inDegree.set(id, 0));

        data.nodes.forEach(n => {
          if (n.left) {
            if (!nodeIds.has(n.left)) {
              errors.push(`dsa_tree: node '${n.id}' left child references nonexistent node '${n.left}'.`);
            } else {
              inDegree.set(n.left, (inDegree.get(n.left) || 0) + 1);
            }
          }
          if (n.right) {
            if (!nodeIds.has(n.right)) {
              errors.push(`dsa_tree: node '${n.id}' right child references nonexistent node '${n.right}'.`);
            } else {
              inDegree.set(n.right, (inDegree.get(n.right) || 0) + 1);
            }
          }
        });

        // Check for single root and cycles
        let rootCount = 0;
        inDegree.forEach((count, id) => {
          if (count === 0) rootCount++;
          if (count > 1) errors.push(`dsa_tree: node '${id}' has multiple parents.`);
        });
        if (rootCount === 0 && data.nodes.length > 0) {
          errors.push('dsa_tree: tree contains cycles (no root found).');
        }
      }
      break;
    }

    case 'dsa_graph': {
      if (typeof data.directed !== 'boolean' || typeof data.weighted !== 'boolean') {
        errors.push("dsa_graph: 'directed' and 'weighted' must be boolean flags.");
      }
      if (!Array.isArray(data.nodes) || data.nodes.length < 2 || data.nodes.length > 20) {
        errors.push('dsa_graph: nodes must be an array of 2 to 20 nodes.');
      }
      const nodeIds = new Set((data.nodes || []).map(n => n && n.id).filter(Boolean));
      if (!Array.isArray(data.edges) || data.edges.length > 40) {
        errors.push('dsa_graph: edges must be an array of at most 40 edges.');
      } else {
        data.edges.forEach((e, idx) => {
          if (!e || typeof e !== 'object' || !nodeIds.has(e.from) || !nodeIds.has(e.to)) {
            errors.push(`dsa_graph: edge at index ${idx} references nonexistent node (${e.from} -> ${e.to}).`);
          }
        });
      }
      if (data.startNode && !nodeIds.has(data.startNode)) {
        errors.push(`dsa_graph: startNode '${data.startNode}' does not exist in nodes.`);
      }
      break;
    }

    case 'mem_ptr': {
      if (!Array.isArray(data.segments) || data.segments.length === 0 || data.segments.length > 16) {
        errors.push('mem_ptr: segments must be an array of 1 to 16 memory blocks.');
      } else {
        const addresses = new Set(data.segments.map(s => s && s.address).filter(Boolean));
        data.segments.forEach((seg, idx) => {
          if (!seg || typeof seg !== 'object') {
            errors.push(`mem_ptr: segment at index ${idx} is not an object.`);
            return;
          }
          if (!seg.address || typeof seg.address !== 'string') {
            errors.push(`mem_ptr: segment at index ${idx} missing string address.`);
          }
          if (!seg.variable || typeof seg.variable !== 'string') {
            errors.push(`mem_ptr: segment at index ${idx} missing variable name.`);
          }
          if (seg.pointsTo && !addresses.has(seg.pointsTo)) {
            errors.push(`mem_ptr: pointer '${seg.variable}' pointsTo nonexistent address '${seg.pointsTo}'.`);
          }
        });
      }
      break;
    }

    case 'logic_sim': {
      if (!Array.isArray(data.inputs) || data.inputs.length === 0 || data.inputs.length > 6) {
        errors.push('logic_sim: inputs must be an array of 1 to 6 inputs.');
      }
      const inputIds = new Set((data.inputs || []).map(i => i && i.id).filter(Boolean));
      const gateIds = new Set();
      if (!Array.isArray(data.gates) || data.gates.length === 0 || data.gates.length > 15) {
        errors.push('logic_sim: gates must be an array of 1 to 15 gates.');
      } else {
        const allowedGateTypes = ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR'];
        data.gates.forEach((g, idx) => {
          if (!g || typeof g !== 'object' || !allowedGateTypes.includes(g.type)) {
            errors.push(`logic_sim: gate at index ${idx} has invalid type.`);
          }
          if (g.id) {
            if (inputIds.has(g.id) || gateIds.has(g.id)) {
              errors.push(`logic_sim: duplicate identifier '${g.id}'.`);
            }
            gateIds.add(g.id);
          }
        });

        // Verify gate input referential integrity
        data.gates.forEach((g, idx) => {
          if (!Array.isArray(g.inputs) || g.inputs.length === 0) {
            errors.push(`logic_sim: gate '${g.id}' has no inputs.`);
          } else {
            g.inputs.forEach(inp => {
              if (!inputIds.has(inp) && !gateIds.has(inp)) {
                errors.push(`logic_sim: gate '${g.id}' input '${inp}' does not reference a valid input or gate.`);
              }
            });
          }
        });
      }
      break;
    }

    case 'truth_table': {
      if (!Array.isArray(data.variables) || data.variables.length === 0 || data.variables.length > 4) {
        errors.push('truth_table: variables must be an array of 1 to 4 variable names.');
      }
      if (!data.expression || typeof data.expression !== 'string' || data.expression.length > 100) {
        errors.push('truth_table: valid expression string is required (max 100 chars).');
      }
      break;
    }

    case 'num_sim': {
      const allowedMethods = ['bisection', 'newton_raphson', 'secant', 'trapezoidal', 'simpson_1_3'];
      if (!allowedMethods.includes(data.method)) {
        errors.push(`num_sim: method must be one of [${allowedMethods.join(', ')}].`);
      }
      if (!data.equation || typeof data.equation !== 'string' || data.equation.length > 80) {
        errors.push('num_sim: equation must be a valid string (max 80 chars).');
      }
      if (!data.parameters || typeof data.parameters !== 'object') {
        errors.push('num_sim: parameters object is required.');
      }
      break;
    }

    case 'os_sim': {
      const allowedSimTypes = ['cpu_scheduling', 'page_replacement'];
      if (!allowedSimTypes.includes(data.simulationType)) {
        errors.push(`os_sim: simulationType must be one of [${allowedSimTypes.join(', ')}].`);
      }
      if (data.simulationType === 'cpu_scheduling') {
        if (!data.scheduling || typeof data.scheduling !== 'object') {
          errors.push('os_sim: scheduling object is required for cpu_scheduling.');
        } else {
          const allowedSched = ['fcfs', 'sjf_non_preemptive', 'sjf_preemptive', 'round_robin', 'priority'];
          if (!allowedSched.includes(data.scheduling.algorithm)) {
            errors.push(`os_sim: scheduling algorithm must be one of [${allowedSched.join(', ')}].`);
          }
          if (!Array.isArray(data.scheduling.processes) || data.scheduling.processes.length === 0 || data.scheduling.processes.length > 10) {
            errors.push('os_sim: processes must be an array of 1 to 10 processes.');
          }
        }
      } else if (data.simulationType === 'page_replacement') {
        if (!data.paging || typeof data.paging !== 'object') {
          errors.push('os_sim: paging object is required for page_replacement.');
        } else {
          const allowedPageAlgos = ['fifo', 'lru', 'optimal'];
          if (!allowedPageAlgos.includes(data.paging.algorithm)) {
            errors.push(`os_sim: paging algorithm must be one of [${allowedPageAlgos.join(', ')}].`);
          }
          if (typeof data.paging.frameCount !== 'number' || data.paging.frameCount < 2 || data.paging.frameCount > 6) {
            errors.push('os_sim: frameCount must be between 2 and 6.');
          }
          if (!Array.isArray(data.paging.referenceString) || data.paging.referenceString.length < 5 || data.paging.referenceString.length > 30) {
            errors.push('os_sim: referenceString must contain between 5 and 30 page numbers.');
          }
        }
      }
      break;
    }

    case 'db_rel': {
      if (!Array.isArray(data.entities) || data.entities.length === 0 || data.entities.length > 12) {
        errors.push('db_rel: entities must be an array of 1 to 12 entities.');
      }
      const entityNames = new Set((data.entities || []).map(e => e && e.name).filter(Boolean));
      if (Array.isArray(data.relationships)) {
        data.relationships.forEach((rel, idx) => {
          if (!rel || typeof rel !== 'object' || !entityNames.has(rel.from) || !entityNames.has(rel.to)) {
            errors.push(`db_rel: relationship at index ${idx} references nonexistent entity.`);
          }
        });
      }
      break;
    }

    case 'sql_exec': {
      if (typeof data.initialSchemaSql !== 'string' || data.initialSchemaSql.length > 4000) {
        errors.push('sql_exec: initialSchemaSql must be a string (max 4000 chars).');
      }
      if (data.defaultQuery && (typeof data.defaultQuery !== 'string' || data.defaultQuery.length > 2000)) {
        errors.push('sql_exec: defaultQuery must be a string (max 2000 chars).');
      }
      break;
    }

    case 'net_proto': {
      const allowedProtos = ['tcp_handshake', 'tcp_teardown', 'stop_and_wait', 'go_back_n'];
      if (!allowedProtos.includes(data.protocol)) {
        errors.push(`net_proto: protocol must be one of [${allowedProtos.join(', ')}].`);
      }
      if (!Array.isArray(data.actors) || data.actors.length !== 2) {
        errors.push('net_proto: actors must be an array of exactly 2 participant strings.');
      }
      if (!Array.isArray(data.messages) || data.messages.length === 0 || data.messages.length > 16) {
        errors.push('net_proto: messages must be an array of 1 to 16 messages.');
      }
      break;
    }

    case 'net_subnet': {
      if (typeof data.ipAddress !== 'string' || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(data.ipAddress)) {
        errors.push('net_subnet: valid IPv4 ipAddress is required.');
      }
      if (typeof data.cidrPrefix !== 'number' || data.cidrPrefix < 8 || data.cidrPrefix > 30) {
        errors.push('net_subnet: cidrPrefix must be an integer between 8 and 30.');
      }
      break;
    }

    case 'uml_arch': {
      const allowedTypes = ['class', 'sequence', 'usecase', 'activity'];
      if (!allowedTypes.includes(data.diagramType)) {
        errors.push(`uml_arch: diagramType must be one of [${allowedTypes.join(', ')}].`);
      }
      if (typeof data.mermaidSource !== 'string' || data.mermaidSource.length === 0 || data.mermaidSource.length > 8000) {
        errors.push('uml_arch: mermaidSource must be a non-empty string under 8000 chars.');
      }
      break;
    }

    case 'cg_trans': {
      if (!Array.isArray(data.polygon) || data.polygon.length < 3 || data.polygon.length > 10) {
        errors.push('cg_trans: polygon must contain between 3 and 10 coordinate pairs.');
      }
      if (!data.transformation || typeof data.transformation !== 'object') {
        errors.push('cg_trans: transformation object is required.');
      }
      break;
    }

    case 'web_dom': {
      if (typeof data.html !== 'string' || data.html.length === 0 || data.html.length > 6000) {
        errors.push('web_dom: html must be a string up to 6000 chars.');
      }
      break;
    }

    case 'ai_search': {
      const allowedAlgos = ['a_star', 'greedy_best_first', 'bfs', 'dfs'];
      if (!allowedAlgos.includes(data.algorithm)) {
        errors.push(`ai_search: algorithm must be one of [${allowedAlgos.join(', ')}].`);
      }
      if (!data.graph || typeof data.graph !== 'object') {
        errors.push('ai_search: graph object is required.');
      }
      break;
    }

    case 'compiler_run': {
      const allowedLangs = ['c', 'cpp', 'java', 'python'];
      if (!allowedLangs.includes(data.language)) {
        errors.push(`compiler_run: language must be one of [${allowedLangs.join(', ')}].`);
      }
      if (typeof data.code !== 'string' || data.code.length === 0 || data.code.length > 32000) {
        errors.push('compiler_run: code must be a string up to 32000 chars.');
      }
      break;
    }

    default:
      errors.push(`Unknown engine type '${engine}'.`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates a Kyana Academic Visual Payload.
 * Accepts a raw JSON string or parsed object.
 *
 * @param {string|object} rawInput
 * @returns {{ valid: boolean, errors?: string[], sanitized?: object, fallbackText?: string }}
 */
function validateVisualContract(rawInput) {
  const errors = [];

  if (rawInput === null || rawInput === undefined) {
    return {
      valid: false,
      errors: ['Input payload is empty or null.'],
      fallbackText: null
    };
  }

  let rawString = '';
  let parsed = null;

  if (typeof rawInput === 'string') {
    rawString = rawInput.trim();
    if (getByteLength(rawString) > MAX_PAYLOAD_BYTES) {
      return {
        valid: false,
        errors: [`Payload size (${getByteLength(rawString)} bytes) exceeds maximum ceiling of ${MAX_PAYLOAD_BYTES} bytes.`],
        fallbackText: null
      };
    }

    // Prototype pollution string check
    if (containsPrototypePollution(rawString)) {
      return {
        valid: false,
        errors: ['Security Violation: Prototype pollution key detected in payload string.'],
        fallbackText: null
      };
    }

    // Executable code / script check
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(rawString)) {
        return {
          valid: false,
          errors: ['Security Violation: Executable script or dangerous markup detected in payload.'],
          fallbackText: null
        };
      }
    }

    try {
      parsed = JSON.parse(rawString);
    } catch (e) {
      return {
        valid: false,
        errors: [`JSON Syntax Error: ${e.message}`],
        fallbackText: null
      };
    }
  } else if (typeof rawInput === 'object') {
    parsed = rawInput;
    try {
      rawString = JSON.stringify(parsed);
      if (getByteLength(rawString) > MAX_PAYLOAD_BYTES) {
        return {
          valid: false,
          errors: [`Payload size exceeds maximum ceiling of ${MAX_PAYLOAD_BYTES} bytes.`],
          fallbackText: null
        };
      }
    } catch (_) {}
  } else {
    return {
      valid: false,
      errors: ['Input payload must be a string or JSON object.'],
      fallbackText: null
    };
  }

  // Deep prototype pollution scan on parsed object
  if (hasUnsafePrototypes(parsed)) {
    return {
      valid: false,
      errors: ['Security Violation: Object contains unsafe prototype properties (__proto__, constructor, prototype).'],
      fallbackText: null
    };
  }

  // Top-Level Envelope Validation
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      valid: false,
      errors: ['Root payload must be an object.'],
      fallbackText: null
    };
  }

  // Envelope normalization and aliases
  if (!parsed.engine && parsed.engineId) {
    parsed.engine = parsed.engineId;
  }
  if (!parsed.data && parsed.payload) {
    parsed.data = parsed.payload;
  }
  if (typeof parsed.fallback === 'string') {
    parsed.fallback = {
      type: 'markdown',
      content: parsed.fallback
    };
  } else if (parsed.fallback && typeof parsed.fallback === 'object' && parsed.fallback.text && !parsed.fallback.content) {
    parsed.fallback = {
      type: parsed.fallback.type || 'text',
      content: String(parsed.fallback.text)
    };
  }

  // Version check
  if (!ALLOWED_VERSIONS.has(parsed.version)) {
    errors.push(`Field 'version' must be one of [${Array.from(ALLOWED_VERSIONS).join(', ')}]. Received '${parsed.version}'.`);
  }

  // Engine check
  if (!ALLOWED_ENGINES.has(parsed.engine)) {
    errors.push(`Field 'engine' must be one of [${Array.from(ALLOWED_ENGINES).join(', ')}]. Received '${parsed.engine}'.`);
  }

  // Mode check
  if (!ALLOWED_MODES.has(parsed.mode)) {
    errors.push(`Field 'mode' must be one of [${Array.from(ALLOWED_MODES).join(', ')}]. Received '${parsed.mode}'.`);
  }

  // Title check
  if (!parsed.title || typeof parsed.title !== 'string' || parsed.title.trim().length < 3 || parsed.title.length > 120) {
    errors.push("Field 'title' is required and must be between 3 and 120 characters.");
  }

  // Fallback check
  let fallbackText = null;
  if (!parsed.fallback || typeof parsed.fallback !== 'object') {
    errors.push("Field 'fallback' object is required.");
  } else {
    if (!['text', 'markdown'].includes(parsed.fallback.type)) {
      errors.push("Field 'fallback.type' must be 'text' or 'markdown'.");
    }
    if (!parsed.fallback.content || typeof parsed.fallback.content !== 'string' || !parsed.fallback.content.trim()) {
      errors.push("Field 'fallback.content' must be a non-empty string.");
    } else {
      fallbackText = parsed.fallback.content.trim();
    }
  }

  // Subject code (optional)
  if (parsed.subjectCode !== undefined && parsed.subjectCode !== null) {
    if (typeof parsed.subjectCode !== 'string' || !/^[A-Z]{3}\d{3}$/.test(parsed.subjectCode)) {
      errors.push("Field 'subjectCode' must match pattern '^[A-Z]{3}\\d{3}$' (e.g. 'CIT214').");
    }
  }

  // Semester (optional)
  if (parsed.semester !== undefined && parsed.semester !== null) {
    if (typeof parsed.semester !== 'number' || !Number.isInteger(parsed.semester) || parsed.semester < 1 || parsed.semester > 8) {
      errors.push("Field 'semester' must be an integer between 1 and 8.");
    }
  }

  // Engine-specific payload validation
  if (ALLOWED_ENGINES.has(parsed.engine)) {
    const engineValidation = validateEngineData(parsed.engine, parsed.data);
    if (!engineValidation.valid) {
      errors.push(...engineValidation.errors);
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      fallbackText
    };
  }

  const sanitized = {
    version: parsed.version,
    engineId: parsed.engine,
    mode: parsed.mode,
    title: parsed.title.trim(),
    fallback: {
      type: parsed.fallback.type,
      content: parsed.fallback.content.trim()
    },
    payload: parsed.data
  };
  if (parsed.subjectCode) sanitized.subjectCode = parsed.subjectCode;
  if (parsed.semester) sanitized.semester = parsed.semester;

  return {
    valid: true,
    sanitized,
    fallbackText
  };
}

  return {
    MAX_PAYLOAD_BYTES,
    ALLOWED_VERSIONS,
    ALLOWED_MODES,
    ALLOWED_ENGINES,
    validateVisualContract
  };
}));
