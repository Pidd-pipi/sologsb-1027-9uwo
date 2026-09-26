import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Button,
  Callout,
  Card,
  Checkbox,
  Dialog,
  Divider,
  Elevation,
  FormGroup,
  HTMLSelect,
  Icon,
  InputGroup,
  ProgressBar,
  Tab,
  Tabs,
  Tag,
  TextArea
} from '@blueprintjs/core';

type StepStatus = 'draft' | 'submitted' | 'confirmed' | 'returned';
type ProcessStatus = 'draft' | 'in-review' | 'frozen';
type ViewId = 'editor' | 'review' | 'compare';

interface ReviewComment {
  id: string;
  author: string;
  role: string;
  text: string;
  createdAt: string;
  resolved: boolean;
}

interface ProcessStep {
  id: string;
  title: string;
  purpose: string;
  materials: string;
  equipment: string;
  amount: string;
  duration: number;
  hazards: string[];
  controls: string;
  dependencies: string[];
  safetyNote: string;
  expectedResult: string;
  status: StepStatus;
  comments: ReviewComment[];
}

interface VersionNode {
  id: string;
  parentId: string | null;
  frozen: boolean;
  version: string;
  label: string;
  /** 冻结时记录本次改动摘要；未冻结时记录修订来源说明。 */
  note: string;
  author: string;
  createdAt: string;
  frozenAt?: string;
  steps: ProcessStep[];
}

interface ExperimentProcess {
  id: string;
  title: string;
  code: string;
  objective: string;
  principal: string;
  lab: string;
  nodes: VersionNode[];
  rootNodeId: string;
  updatedAt: string;
}

interface HistoryState {
  past: ExperimentProcess[];
  present: ExperimentProcess;
  future: ExperimentProcess[];
}

interface DiffItem {
  id: string;
  title: string;
  kind: 'added' | 'removed' | 'changed';
  detail: string;
}

interface TreeEntry {
  node: VersionNode;
  depth: number;
}

const STORAGE_KEY = 'sologsb-1027-lab-safety-v2';
const ACTIVE_NODE_KEY = 'sologsb-1027-lab-safety-active-node-v2';
const CURRENT_AUTHOR = '周宁';
const CURRENT_ROLE = '安全复核员';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function initialProcess(): ExperimentProcess {
  const baseSteps: ProcessStep[] = [
    {
      id: 'step-1', title: '核对试剂与实验区域', purpose: '确认所需物料、设备及区域状态符合实验方案。',
      materials: '无水乙醇、去离子水', equipment: '通风柜、防爆柜、标签打印机', amount: '乙醇 120 mL；去离子水 300 mL',
      duration: 15, hazards: ['易燃液体'], controls: '在通风柜内取用，远离点火源；使用接地金属容器。',
      dependencies: [], safetyNote: '操作人员需佩戴护目镜和防化手套。', expectedResult: '试剂标签、数量和有效期均核对无误。',
      status: 'confirmed', comments: [
        { id: 'c-1', author: '李明', role: '研究员', text: '已核对批号和有效期，防爆柜温度记录正常。', createdAt: '2026-09-24T09:10:00+08:00', resolved: true }
      ]
    },
    {
      id: 'step-2', title: '搭建恒温循环装置', purpose: '连接循环浴与反应夹套，检查密封和温控。',
      materials: '无', equipment: '恒温循环浴、硅胶管、反应夹套、扎带', amount: '循环液 800 mL',
      duration: 25, hazards: ['烫伤', '管路脱落'], controls: '管路双端固定；升温前完成 5 分钟试压并设置独立超温断电。',
      dependencies: ['step-1'], safetyNote: '高温表面设置警示标识，循环浴周围保持干燥。', expectedResult: '30 分钟内温度稳定在 55 ± 0.5 ℃。',
      status: 'confirmed', comments: [
        { id: 'c-2', author: '王颖', role: '安全复核员', text: '补充超温断电值，不能只依赖设备自带温控。', createdAt: '2026-09-24T10:05:00+08:00', resolved: true }
      ]
    },
    {
      id: 'step-3', title: '加入催化剂并启动反应', purpose: '按批次加入催化剂，记录起点并开始计时。',
      materials: '催化剂 A', equipment: '分析天平、加料漏斗、计时器', amount: '催化剂 A 2.50 ± 0.02 g',
      duration: 20, hazards: ['粉尘吸入', '放热反应'], controls: '在通风柜内称量，佩戴 N95 口罩；分三次少量加入并监测温度。',
      dependencies: ['step-2'], safetyNote: '反应温度超过 70 ℃ 时立即停止加料并启动冷却。', expectedResult: '温度缓慢升至 62–66 ℃，无明显冲料。',
      status: 'submitted', comments: []
    },
    {
      id: 'step-4', title: '恒温反应与过程取样', purpose: '维持温度并定时取样观察反应转化。',
      materials: '样品瓶、惰性气体', equipment: '取样针、气相色谱、恒温循环浴', amount: '每点样品约 1 mL，共 6 点',
      duration: 90, hazards: ['高温液体', '挥发性气体'], controls: '取样前泄压；使用长针和防护屏；样品瓶及时封闭。',
      dependencies: ['step-3'], safetyNote: '取样时不得正对瓶口，样品瓶不得完全密封后加热。', expectedResult: '转化率达到 95% 以上且无异常副产物。',
      status: 'submitted', comments: []
    },
    {
      id: 'step-5', title: '停止加热并冷却', purpose: '终止反应并将体系降至安全温度。',
      materials: '无', equipment: '循环浴、温度探头', amount: '降温目标 ≤ 30 ℃', duration: 35,
      hazards: ['烫伤', '残余反应'], controls: '先停止加料并维持搅拌，再以不超过 1 ℃/min 的速率降温。',
      dependencies: ['step-4'], safetyNote: '确认温度连续 5 分钟低于 30 ℃ 后才能拆除装置。', expectedResult: '体系温度稳定低于 30 ℃。',
      status: 'draft', comments: []
    },
    {
      id: 'step-6', title: '废液分类与现场恢复', purpose: '按危险废物要求分类收集并恢复实验区域。',
      materials: '废液桶、吸附棉', equipment: '防化手套、护目镜、危废标签', amount: '按实际产生量记录', duration: 25,
      hazards: ['废液混装', '化学暴露'], controls: '有机废液单独收集，核对相容性后贴标签；泄漏吸附材料按危废处置。',
      dependencies: ['step-5'], safetyNote: '废液不得倒入下水道，现场恢复后完成双人确认。', expectedResult: '废液交接记录完整，台面无残留。',
      status: 'draft', comments: []
    }
  ];

  const firstVersion: VersionNode = {
    id: 'version-1-0', parentId: null, frozen: true, label: '首版批准流程', version: '1.0.0',
    createdAt: '2026-09-20T14:30:00+08:00', frozenAt: '2026-09-20T14:30:00+08:00',
    note: '建立基础反应与取样步骤。', author: '王颖',
    steps: clone(baseSteps).slice(0, 4).map((step) => ({ ...step, status: 'confirmed', comments: [] }))
  };
  const secondVersion: VersionNode = {
    id: 'version-1-1', parentId: 'version-1-0', frozen: true, label: '补充冷却与废液步骤', version: '1.1.0',
    createdAt: '2026-09-24T15:10:00+08:00', frozenAt: '2026-09-24T15:10:00+08:00',
    note: '增加安全冷却、废液处置和现场恢复。', author: '王颖',
    steps: clone(baseSteps).map((step) => ({ ...step, status: 'confirmed', comments: [] }))
  };
  const currentDraft: VersionNode = {
    id: 'version-1-1-0-1-draft', parentId: 'version-1-1', frozen: false, label: '修订稿', version: '1.1.0.1',
    createdAt: '2026-09-25T09:00:00+08:00',
    note: '基于 1.1.0 建立修订稿，补充降温速率与取样防护。', author: '李明',
    steps: clone(baseSteps).map((step) =>
      step.id === 'step-5'
        ? { ...step, controls: `${step.controls}降温全过程每 5 分钟记录一次温度，实际降温速率不超过 0.8 ℃/min，记录双人复核。` }
        : step
    )
  };

  return {
    id: 'exp-catalyst-2026-09', title: '负载型催化剂评价实验', code: 'SAFE-CAT-026',
    objective: '在受控温度下评价催化剂活性，并完整记录过程样品与安全控制措施。',
    principal: '李明', lab: '材料化学实验室 B-207',
    nodes: [firstVersion, secondVersion, currentDraft], rootNodeId: firstVersion.id,
    updatedAt: new Date().toISOString()
  };
}

/** 兼容旧存档：补齐步骤缺失字段，避免渲染时空引用。 */
function normalizeStep(step: Partial<ProcessStep> & { id: string }): ProcessStep {
  return {
    id: step.id,
    title: step.title ?? '',
    purpose: step.purpose ?? '',
    materials: step.materials ?? '',
    equipment: step.equipment ?? '',
    amount: step.amount ?? '',
    duration: typeof step.duration === 'number' ? step.duration : 10,
    hazards: Array.isArray(step.hazards) ? step.hazards : [],
    controls: step.controls ?? '',
    dependencies: Array.isArray(step.dependencies) ? step.dependencies : [],
    safetyNote: step.safetyNote ?? '',
    expectedResult: step.expectedResult ?? '',
    status: step.status ?? 'draft',
    comments: Array.isArray(step.comments) ? step.comments : []
  };
}

/** 旧版扁平 versions 结构迁移为版本树。 */
function migrateProcess(value: unknown): ExperimentProcess | null {
  if (!value || typeof value !== 'object') return null;
  const parsed = value as Partial<ExperimentProcess> & {
    versions?: Array<{
      id: string; label: string; version: string; createdAt: string; note: string; author: string;
      steps: ProcessStep[];
    }>;
    steps?: ProcessStep[];
    status?: string;
    version?: string;
    frozenAt?: string;
  };
  if (!parsed.id || !Array.isArray(parsed.nodes)) {
    const snapshots = parsed.versions ?? [];
    if (!snapshots.length || !Array.isArray(parsed.steps)) return null;
    const nodes: VersionNode[] = snapshots.map((snapshot, index) => ({
      id: snapshot.id,
      parentId: index === 0 ? null : snapshots[index - 1].id,
      frozen: true,
      version: snapshot.version,
      label: snapshot.label,
      note: snapshot.note,
      author: snapshot.author,
      createdAt: snapshot.createdAt,
      frozenAt: snapshot.createdAt,
      steps: clone(snapshot.steps ?? []).map(normalizeStep)
    }));
    const rootNodeId = nodes[0].id;
    const lastFrozen = nodes[nodes.length - 1];
    nodes.push({
      id: uid('node'), parentId: lastFrozen.id, frozen: false,
      version: childVersion(nodes, lastFrozen, nodeDepth(nodes, lastFrozen.id), nodes.filter((node) => node.parentId === lastFrozen.id).length),
      label: '迁移前工作稿', note: `基于 ${lastFrozen.version} 的未冻结工作稿。`,
      author: lastFrozen.author, createdAt: parsed.updatedAt ?? new Date().toISOString(),
      steps: clone(parsed.steps ?? []).map(normalizeStep)
    });
    return {
      id: parsed.id ?? 'exp-migrated',
      title: parsed.title ?? '', code: parsed.code ?? '', objective: parsed.objective ?? '',
      principal: parsed.principal ?? '', lab: parsed.lab ?? '',
      nodes, rootNodeId, updatedAt: parsed.updatedAt ?? new Date().toISOString()
    };
  }
  const process = parsed as ExperimentProcess;
  if (!process.rootNodeId || !process.nodes.length) return null;
  process.nodes.forEach((node) => { node.steps = (node.steps ?? []).map(normalizeStep); });
  return process.rootNodeId && process.nodes.some((node) => node.id === process.rootNodeId) ? process : null;
}

function historyReducer(state: HistoryState, action:
  | { type: 'commit'; update: (draft: ExperimentProcess) => void }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; value: ExperimentProcess }
): HistoryState {
  if (action.type === 'commit') {
    const next = clone(state.present);
    action.update(next);
    next.updatedAt = new Date().toISOString();
    return { past: [...state.past.slice(-59), clone(state.present)], present: next, future: [] };
  }
  if (action.type === 'undo') {
    const previous = state.past.at(-1);
    if (!previous) return state;
    return { past: state.past.slice(0, -1), present: previous, future: [clone(state.present), ...state.future].slice(0, 60) };
  }
  if (action.type === 'redo') {
    const next = state.future[0];
    if (!next) return state;
    return { past: [...state.past, clone(state.present)].slice(-60), present: next, future: state.future.slice(1) };
  }
  return { past: [], present: action.value, future: [] };
}

function loadProcess(): ExperimentProcess {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current) {
      const migrated = migrateProcess(JSON.parse(current) as unknown);
      if (migrated) return migrated;
    }
    const legacy = localStorage.getItem('sologsb-1027-lab-safety-v1');
    if (legacy) {
      const migrated = migrateProcess(JSON.parse(legacy) as unknown);
      if (migrated) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated)); } catch { /* ignore */ }
        return migrated;
      }
    }
  } catch {
    return initialProcess();
  }
  return initialProcess();
}

function splitList(value: string): string[] {
  return value.split(/[\n,，、;；]+/).map((item) => item.trim()).filter(Boolean);
}

function statusLabel(status: StepStatus): string {
  return status === 'confirmed' ? '已确认' : status === 'returned' ? '已退回' : status === 'submitted' ? '待复核' : '草稿';
}

function processStatusLabel(status: ProcessStatus): string {
  return status === 'frozen' ? '已冻结' : status === 'in-review' ? '复核中' : '修订中';
}

function nodeProcessStatus(node: VersionNode): ProcessStatus {
  if (node.frozen) return 'frozen';
  return node.steps.some((step) => step.status === 'submitted' || step.status === 'returned') ? 'in-review' : 'draft';
}

function draftVersion(node: VersionNode): string {
  return node.frozen ? node.version : `${node.version}-draft`;
}

function nodeDepth(nodes: VersionNode[], nodeId: string): number {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let depth = 0;
  let current = byId.get(nodeId);
  while (current?.parentId) {
    depth += 1;
    current = byId.get(current.parentId);
  }
  return depth;
}

/**
 * 子版本号规则：
 * - 根版本的子版本沿用主版本线次版本号递增（1.0.0 → 1.1.0、1.2.0），
 *   并与历史扁平版本号段避让，避免与迁移数据冲突；
 * - 其余冻结版本下的修订稿成为追加段号的子版本（1.1.0 → 1.1.0.1），
 *   不同来源的分支号互不冲突，版本号全局唯一。
 */
function childVersion(nodes: VersionNode[], parent: VersionNode, depth: number, slot: number): string {
  if (depth === 0) {
    const match = parent.version.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (match) {
      const major = match[1];
      const occupied = new Set(
        nodes
          .map((node) => node.version.match(/^(\d+)\.(\d+)\.\d+$/) ?? undefined)
          .filter((parts): parts is RegExpMatchArray => Boolean(parts && parts[1] === major))
          .map((parts) => Number(parts[2]))
      );
      let minor = Number(match[2]) + slot + 1;
      while (occupied.has(minor)) minor += 1;
      return `${major}.${minor}.0`;
    }
  }
  return `${parent.version}.${slot + 1}`;
}

function childrenOf(nodes: VersionNode[], parentId: string): VersionNode[] {
  return nodes
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function flattenTree(nodes: VersionNode[], rootId: string): TreeEntry[] {
  const entries: TreeEntry[] = [];
  const walk = (nodeId: string, depth: number) => {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) return;
    entries.push({ node, depth });
    childrenOf(nodes, nodeId).forEach((child) => walk(child.id, depth + 1));
  };
  walk(rootId, 0);
  return entries;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

function App() {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => ({ past: [], present: loadProcess(), future: [] }));
  const process = history.present;
  const [activeNodeId, setActiveNodeId] = useState<string>(() => {
    const loaded = loadProcess();
    const saved = (() => { try { return localStorage.getItem(ACTIVE_NODE_KEY); } catch { return null; } })();
    if (saved && loaded.nodes.some((node) => node.id === saved)) return saved;
    return loaded.nodes.find((node) => !node.frozen)?.id ?? loaded.rootNodeId;
  });
  const activeNode = process.nodes.find((node) => node.id === activeNodeId)
    ?? process.nodes.find((node) => node.id === process.rootNodeId)!;
  const parentNode = activeNode.parentId ? process.nodes.find((node) => node.id === activeNode.parentId) : undefined;
  const treeEntries = useMemo(() => flattenTree(process.nodes, process.rootNodeId), [process.nodes, process.rootNodeId]);

  const [selectedStepId, setSelectedStepId] = useState(activeNode.steps[0]?.id ?? '');
  const [activeView, setActiveView] = useState<ViewId>('editor');
  const [lastModifiedId, setLastModifiedId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [savedLabel, setSavedLabel] = useState('本地数据已载入');
  const [online, setOnline] = useState(true);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [freezeNote, setFreezeNote] = useState('');
  const [compareBaseId, setCompareBaseId] = useState(parentNode?.id ?? activeNode.id);
  const [compareTargetId, setCompareTargetId] = useState(activeNode.id);
  const initialSaveSkipped = useRef(false);

  const readOnly = activeNode.frozen;
  const selectedStep = activeNode.steps.find((step) => step.id === selectedStepId) ?? activeNode.steps[0];
  const downstreamIds = useMemo(() => collectDownstream(activeNode.steps, lastModifiedId), [activeNode.steps, lastModifiedId]);
  const impactedSteps = activeNode.steps.filter((step) => downstreamIds.includes(step.id));
  const missingSafetySteps = activeNode.steps.filter(hasMissingSafety);
  const pendingReviewCount = activeNode.steps.filter((step) => step.status === 'submitted' || step.status === 'returned').length;
  const confirmedCount = activeNode.steps.filter((step) => step.status === 'confirmed').length;
  const reviewProgress = activeNode.steps.length ? Math.round((confirmedCount / activeNode.steps.length) * 100) : 0;
  const versionDiff = useMemo(
    () => compareNodeSteps(process.nodes, compareBaseId, compareTargetId),
    [process.nodes, compareBaseId, compareTargetId]
  );
  const freezeReady = confirmedCount === activeNode.steps.length && missingSafetySteps.length === 0;

  useEffect(() => {
    if (!initialSaveSkipped.current) {
      initialSaveSkipped.current = true;
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(process));
    setSavedLabel(`自动保存 · ${formatDate(new Date().toISOString())}`);
  }, [process]);

  useEffect(() => {
    try { localStorage.setItem(ACTIVE_NODE_KEY, activeNodeId); } catch { /* ignore */ }
  }, [activeNodeId]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) return;
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? dispatch({ type: 'redo' }) : dispatch({ type: 'undo' });
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(process));
        setSavedLabel(`手动保存 · ${formatDate(new Date().toISOString())}`);
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [process]);

  const commitProcess = (update: (draft: ExperimentProcess) => void): void => {
    dispatch({ type: 'commit', update });
  };

  const updateActiveNode = (update: (node: VersionNode) => void): void => {
    const id = activeNode.id;
    commitProcess((draft) => {
      const node = draft.nodes.find((item) => item.id === id);
      if (node && !node.frozen) update(node);
    });
  };

  const activateNode = (nodeId: string, view: ViewId = 'editor'): void => {
    const node = process.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    setActiveNodeId(nodeId);
    setSelectedStepId(node.steps[0]?.id ?? '');
    setLastModifiedId(null);
    setActiveView(view);
  };

  const updateProcessField = (field: 'title' | 'code' | 'objective' | 'principal' | 'lab', value: string): void => {
    if (readOnly) return;
    commitProcess((draft) => { draft[field] = value; });
  };

  const updateStep = (field: keyof ProcessStep, value: unknown): void => {
    if (!selectedStep || readOnly) return;
    const id = selectedStep.id;
    setLastModifiedId(id);
    updateActiveNode((node) => {
      const step = node.steps.find((item) => item.id === id);
      if (step) (step as unknown as Record<string, unknown>)[field] = value;
    });
  };

  const updateStepList = (field: 'hazards' | 'dependencies', value: string): void => {
    updateStep(field, splitList(value));
  };

  const addStep = (): void => {
    if (readOnly) return;
    const id = uid('step');
    updateActiveNode((node) => {
      node.steps.push({
        id, title: '新的实验步骤', purpose: '', materials: '', equipment: '', amount: '', duration: 10,
        hazards: [], controls: '', dependencies: node.steps.at(-1) ? [node.steps.at(-1)!.id] : [],
        safetyNote: '', expectedResult: '', status: 'draft', comments: []
      });
    });
    setSelectedStepId(id);
    setLastModifiedId(id);
    setActiveView('editor');
  };

  const duplicateStep = (): void => {
    if (!selectedStep || readOnly) return;
    const copy: ProcessStep = clone(selectedStep);
    copy.id = uid('step');
    copy.title = `${copy.title}（副本）`;
    copy.status = 'draft';
    copy.comments = [];
    copy.dependencies = [...copy.dependencies];
    const selectedId = selectedStep.id;
    updateActiveNode((node) => {
      const index = node.steps.findIndex((step) => step.id === selectedId);
      node.steps.splice(index + 1, 0, copy);
    });
    setSelectedStepId(copy.id);
  };

  const deleteStep = (): void => {
    if (!selectedStep || activeNode.steps.length <= 1 || readOnly) return;
    const id = selectedStep.id;
    updateActiveNode((node) => {
      node.steps = node.steps.filter((step) => step.id !== id);
      node.steps.forEach((step) => { step.dependencies = step.dependencies.filter((dependency) => dependency !== id); });
    });
    setSelectedStepId(activeNode.steps.find((step) => step.id !== id)?.id ?? '');
  };

  const moveStep = (direction: -1 | 1): void => {
    if (!selectedStep || readOnly) return;
    const id = selectedStep.id;
    updateActiveNode((node) => {
      const index = node.steps.findIndex((step) => step.id === id);
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= node.steps.length) return;
      const [step] = node.steps.splice(index, 1);
      node.steps.splice(nextIndex, 0, step);
    });
    setLastModifiedId(id);
  };

  const toggleDependency = (dependencyId: string, checked: boolean): void => {
    if (!selectedStep || readOnly) return;
    const next = checked
      ? [...new Set([...selectedStep.dependencies, dependencyId])]
      : selectedStep.dependencies.filter((id) => id !== dependencyId);
    updateStep('dependencies', next);
  };

  const submitForReview = (): void => {
    if (readOnly) return;
    updateActiveNode((node) => {
      node.steps.forEach((step) => {
        if (step.status !== 'confirmed') step.status = 'submitted';
      });
    });
    setActiveView('review');
    setSavedLabel('修订稿已提交复核');
  };

  const addReviewComment = (): void => {
    if (!selectedStep || readOnly || !commentText.trim()) return;
    const id = selectedStep.id;
    updateActiveNode((node) => {
      const step = node.steps.find((item) => item.id === id);
      step?.comments.push({
        id: uid('comment'), author: CURRENT_AUTHOR, role: CURRENT_ROLE,
        text: commentText.trim(), createdAt: new Date().toISOString(), resolved: false
      });
    });
    setCommentText('');
  };

  const setStepStatus = (status: StepStatus): void => {
    if (!selectedStep || readOnly) return;
    updateStep('status', status);
    setLastModifiedId(status === 'returned' ? selectedStep.id : null);
  };

  const resolveComment = (commentId: string): void => {
    if (!selectedStep || readOnly) return;
    const stepId = selectedStep.id;
    updateActiveNode((node) => {
      const comment = node.steps.find((step) => step.id === stepId)?.comments.find((item) => item.id === commentId);
      if (comment) comment.resolved = !comment.resolved;
    });
  };

  /** 每个冻结版本至多有一个未冻结子修订；返回该修订节点（若存在）。 */
  const draftChildOf = (parentId: string): VersionNode | undefined =>
    process.nodes.find((node) => node.parentId === parentId && !node.frozen);

  const startRevision = (parentId: string): void => {
    const parent = process.nodes.find((node) => node.id === parentId);
    if (!parent || !parent.frozen) return;
    const existing = draftChildOf(parentId);
    if (existing) {
      activateNode(existing.id);
      setSavedLabel(`请继续 ${parent.version} 下已有的未冻结修订稿`);
      return;
    }
    const id = uid('node');
    const depth = nodeDepth(process.nodes, parentId);
    const slot = process.nodes.filter((node) => node.parentId === parentId).length;
    const version = childVersion(process.nodes, parent, depth, slot);
    const revisionSteps = clone(parent.steps).map((step) => ({ ...step, status: 'draft' as StepStatus, comments: [] }));
    commitProcess((draft) => {
      draft.nodes.push({
        id, parentId, frozen: false, version, label: '修订稿',
        note: `基于 ${parent.version} 建立修订稿。`,
        author: CURRENT_AUTHOR, createdAt: new Date().toISOString(), steps: revisionSteps
      });
    });
    setActiveNodeId(id);
    setSelectedStepId(revisionSteps[0]?.id ?? '');
    setLastModifiedId(null);
    setActiveView('editor');
    setSavedLabel(`已基于 ${parent.version} 建立独立修订稿，不影响其他分支`);
  };

  const openFreezeDialog = (): void => {
    if (readOnly || !freezeReady) {
      setSavedLabel(!readOnly && !freezeReady ? '冻结条件未满足' : savedLabel);
      return;
    }
    setFreezeNote(summarizeChanges(parentNode?.steps ?? [], activeNode.steps));
    setFreezeOpen(true);
  };

  const confirmFreeze = (): void => {
    const id = activeNode.id;
    const version = activeNode.version;
    const parentId = activeNode.parentId;
    const note = freezeNote.trim() || summarizeChanges(parentNode?.steps ?? [], activeNode.steps);
    commitProcess((draft) => {
      const node = draft.nodes.find((item) => item.id === id);
      if (!node || node.frozen) return;
      node.frozen = true;
      node.frozenAt = new Date().toISOString();
      node.note = note;
      node.label = parentId ? '冻结修订版' : '首版冻结';
      node.steps.forEach((step) => { step.status = 'confirmed'; });
    });
    setFreezeOpen(false);
    setSavedLabel(`版本 ${version} 已冻结为来源版本下的子版本`);
    if (parentId) {
      setCompareBaseId(parentId);
      setCompareTargetId(id);
    }
  };

  const compareFromNode = (nodeId: string): void => {
    const node = process.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    setCompareTargetId(nodeId);
    setCompareBaseId(node.parentId ?? nodeId);
    setActiveView('compare');
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-icon"><Icon icon="lab-test" size={23} /></div>
          <div><h1>实验流程安全复核台</h1><p>步骤影响分析 · 逐条复核 · 冻结版本树</p></div>
        </div>
        <div className="header-status">
          <span className={`network ${online ? 'online' : ''}`}></span>
          <span>{online ? '离线保存已启用' : '当前离线，修改仍会保存'}</span>
          <strong>{savedLabel}</strong>
        </div>
        <div className="header-actions">
          <Button icon="undo" text="撤销" minimal disabled={history.past.length === 0} onClick={() => dispatch({ type: 'undo' })} />
          <Button icon="redo" text="重做" minimal disabled={history.future.length === 0} onClick={() => dispatch({ type: 'redo' })} />
          <Button icon="lock" text="冻结版本" intent="primary" onClick={openFreezeDialog} disabled={readOnly || !freezeReady} />
        </div>
      </header>

      {!online && <Callout className="offline-callout" intent="warning" icon="cloud">网络不可用。编辑、复核和版本树仍会保存在当前浏览器。</Callout>}

      <section className="process-banner">
        <div className="banner-main">
          <div className="code-line"><span>{process.code}</span><Tag minimal>{processStatusLabel(nodeProcessStatus(activeNode))}</Tag></div>
          <h2>{process.title}</h2>
          <p>{process.objective}</p>
        </div>
        <div className="banner-meta">
          <div><span>负责人</span><strong>{process.principal}</strong></div>
          <div><span>实验区域</span><strong>{process.lab}</strong></div>
          <div><span>来源版本</span><strong>{parentNode ? parentNode.version : '初始版本'}</strong></div>
        </div>
        <div className="banner-progress">
          <div><span>当前版本</span><strong>{draftVersion(activeNode)}</strong></div>
          <ProgressBar value={reviewProgress / 100} intent={reviewProgress === 100 ? 'success' : 'primary'} stripes={reviewProgress < 100} />
          <small>{pendingReviewCount ? `${pendingReviewCount} 条待处理` : '所有步骤已处理'} · {missingSafetySteps.length} 条安全缺口</small>
        </div>
      </section>

      <Tabs id="workspace-tabs" selectedTabId={activeView} onChange={(value) => setActiveView(value as ViewId)} renderActiveTabPanelOnly className="workspace-tabs">
        <Tab id="editor" title={<span><Icon icon="edit" /> 流程编写</span>} />
        <Tab id="review" title={<span><Icon icon="endorsed" /> 安全复核 {pendingReviewCount > 0 && <b className="tab-badge">{pendingReviewCount}</b>}</span>} />
        <Tab id="compare" title={<span><Icon icon="comparison" /> 版本树与比较</span>} />
      </Tabs>

      {activeView === 'editor' && selectedStep && (
        <main className="editor-layout">
          <aside className="step-panel">
            <div className="panel-heading">
              <div><span>PROCESS STEPS</span><h3>实验步骤</h3></div>
              <Button icon="add" minimal small onClick={addStep} disabled={readOnly} />
            </div>
            <div className="step-list">
              {activeNode.steps.map((step, index) => (
                <button key={step.id} className={step.id === selectedStep.id ? 'selected' : ''} onClick={() => setSelectedStepId(step.id)}>
                  <span className={`step-number ${step.status}`}>{String(index + 1).padStart(2, '0')}</span>
                  <span className="step-copy"><strong>{step.title}</strong><small>{step.duration} 分钟 · {statusLabel(step.status)}</small></span>
                  {hasMissingSafety(step) && <Icon icon="warning-sign" intent="danger" size={13} />}
                </button>
              ))}
            </div>
            <div className="step-actions">
              <Button icon="arrow-up" small minimal disabled={activeNode.steps[0]?.id === selectedStep.id || readOnly} onClick={() => moveStep(-1)} />
              <Button icon="arrow-down" small minimal disabled={activeNode.steps.at(-1)?.id === selectedStep.id || readOnly} onClick={() => moveStep(1)} />
              <Button icon="duplicate" small minimal text="复制" disabled={readOnly} onClick={duplicateStep} />
              <Button icon="trash" small minimal intent="danger" disabled={readOnly} onClick={deleteStep} />
            </div>
          </aside>

          <section className="editor-main">
            {readOnly && (
              <Callout intent="primary" icon="lock" title={`正在查看冻结版本 ${activeNode.version}`}>
                该版本内容只读，不能直接修改，也不会覆盖任何修订稿。可基于此版本单独建立修订稿；
                同一来源仅保留一份未冻结修订。
                <div className="callout-actions">
                  <Button small icon="git-branch" intent="warning"
                    text={draftChildOf(activeNode.id) ? `继续修订稿 ${draftVersion(draftChildOf(activeNode.id)!)}` : `基于 ${activeNode.version} 建立修订稿`}
                    onClick={() => startRevision(activeNode.id)} />
                  <Button small minimal icon="comparison" text="与来源版本比较" onClick={() => compareFromNode(activeNode.id)} />
                </div>
              </Callout>
            )}
            <Card elevation={Elevation.ONE} className="process-meta-card">
              <div className="card-title"><div><span>PROCESS INFO</span><h3>实验基本信息</h3></div><Tag minimal intent="primary">{activeNode.steps.length} 个步骤</Tag></div>
              <div className="meta-grid">
                <FormGroup label="实验名称" labelFor="process-title"><InputGroup id="process-title" fill disabled={readOnly} value={process.title} onChange={(event) => updateProcessField('title', event.target.value)} /></FormGroup>
                <FormGroup label="流程编号" labelFor="process-code"><InputGroup id="process-code" fill disabled={readOnly} value={process.code} onChange={(event) => updateProcessField('code', event.target.value)} /></FormGroup>
                <FormGroup label="负责人" labelFor="principal"><InputGroup id="principal" fill disabled={readOnly} value={process.principal} onChange={(event) => updateProcessField('principal', event.target.value)} /></FormGroup>
                <FormGroup label="实验区域" labelFor="lab"><InputGroup id="lab" fill disabled={readOnly} value={process.lab} onChange={(event) => updateProcessField('lab', event.target.value)} /></FormGroup>
              </div>
              <FormGroup label="实验目标" labelFor="objective"><TextArea id="objective" fill disabled={readOnly} value={process.objective} onChange={(event) => updateProcessField('objective', event.target.value)} /></FormGroup>
            </Card>

            <Card elevation={Elevation.ONE} className="step-editor-card">
              <div className="card-title">
                <div><span>STEP {String(activeNode.steps.indexOf(selectedStep) + 1).padStart(2, '0')}</span><h3>{selectedStep.title}</h3></div>
                <Tag minimal intent={selectedStep.status === 'confirmed' ? 'success' : selectedStep.status === 'returned' ? 'danger' : 'warning'}>{statusLabel(selectedStep.status)}</Tag>
              </div>
              <FormGroup label="步骤名称" labelFor="step-title"><InputGroup id="step-title" fill disabled={readOnly} value={selectedStep.title} onChange={(event) => updateStep('title', event.target.value)} /></FormGroup>
              <FormGroup label="操作目的" labelFor="step-purpose"><TextArea id="step-purpose" fill disabled={readOnly} value={selectedStep.purpose} onChange={(event) => updateStep('purpose', event.target.value)} /></FormGroup>
              <div className="form-grid">
                <FormGroup label="材料" labelFor="materials"><TextArea id="materials" fill disabled={readOnly} value={selectedStep.materials} onChange={(event) => updateStep('materials', event.target.value)} /></FormGroup>
                <FormGroup label="设备" labelFor="equipment"><TextArea id="equipment" fill disabled={readOnly} value={selectedStep.equipment} onChange={(event) => updateStep('equipment', event.target.value)} /></FormGroup>
                <FormGroup label="用量 / 参数" labelFor="amount"><TextArea id="amount" fill disabled={readOnly} value={selectedStep.amount} onChange={(event) => updateStep('amount', event.target.value)} /></FormGroup>
                <FormGroup label="预计时间（分钟）" labelFor="duration"><InputGroup id="duration" type="number" min={1} fill disabled={readOnly} value={String(selectedStep.duration)} onChange={(event) => updateStep('duration', Number(event.target.value))} /></FormGroup>
              </div>
              <div className="form-grid two-column">
                <FormGroup label="危险项（逗号或换行分隔）" labelFor="hazards"><TextArea id="hazards" fill disabled={readOnly} value={selectedStep.hazards.join('，')} onChange={(event) => updateStepList('hazards', event.target.value)} /></FormGroup>
                <FormGroup label="控制措施" labelFor="controls"><TextArea id="controls" fill disabled={readOnly} value={selectedStep.controls} onChange={(event) => updateStep('controls', event.target.value)} /></FormGroup>
              </div>
              <FormGroup label="安全说明" labelFor="safety-note" helperText={hasMissingSafety(selectedStep) ? '存在危险项时，控制措施和安全说明均为必填。' : '安全说明已满足复核条件。'}>
                <TextArea id="safety-note" fill intent={hasMissingSafety(selectedStep) ? 'danger' : 'none'} disabled={readOnly} value={selectedStep.safetyNote} onChange={(event) => updateStep('safetyNote', event.target.value)} />
              </FormGroup>
              <FormGroup label="预期结果" labelFor="expected"><TextArea id="expected" fill disabled={readOnly} value={selectedStep.expectedResult} onChange={(event) => updateStep('expectedResult', event.target.value)} /></FormGroup>
            </Card>

            <Card elevation={Elevation.ONE} className="dependency-card">
              <div className="card-title"><div><span>DEPENDENCIES</span><h3>前置步骤</h3></div><Tag minimal>{selectedStep.dependencies.length} 个依赖</Tag></div>
              <p className="muted">当前步骤只有在所选前置步骤完成后才能进入执行队列。</p>
              <div className="dependency-grid">
                {activeNode.steps.filter((step) => step.id !== selectedStep.id).map((step) => (
                  <Checkbox key={step.id} disabled={readOnly} checked={selectedStep.dependencies.includes(step.id)} label={`${String(activeNode.steps.indexOf(step) + 1).padStart(2, '0')} · ${step.title}`} onChange={(event) => toggleDependency(step.id, event.currentTarget.checked)} />
                ))}
              </div>
            </Card>
          </section>

          <aside className="inspector-panel">
            <Card elevation={Elevation.ONE} className="impact-card">
              <div className="card-title"><div><span>IMPACT ANALYSIS</span><h3>变更影响提醒</h3></div><Icon icon="path-search" size={18} /></div>
              {lastModifiedId ? (
                <>
                  <Callout intent={impactedSteps.length ? 'warning' : 'primary'} icon={impactedSteps.length ? 'warning-sign' : 'tick'}>
                    <strong>{impactedSteps.length ? `${impactedSteps.length} 个后续步骤受影响` : '未发现下游步骤'}</strong>
                    <p>{impactedSteps.length ? '请重新核对依赖、用量、危险项和已确认内容。' : '当前修改没有影响其他步骤的安全条件。'}</p>
                  </Callout>
                  <div className="impact-list">
                    {impactedSteps.map((step) => (
                      <button key={step.id} onClick={() => setSelectedStepId(step.id)}>
                        <Icon icon={step.status === 'confirmed' ? 'endorsed' : 'circle'} intent={step.status === 'confirmed' ? 'success' : 'none'} size={13} />
                        <span><strong>{step.title}</strong><small>{step.status === 'confirmed' ? '已确认内容，需重新复核' : `当前状态：${statusLabel(step.status)}`}</small></span>
                        <Icon icon="chevron-right" size={12} />
                      </button>
                    ))}
                  </div>
                </>
              ) : <p className="muted">编辑任一步骤后，这里会显示受影响的所有后续步骤和已确认内容。</p>}
            </Card>

            <Card elevation={Elevation.ONE} className="safety-card">
              <div className="card-title"><div><span>SAFETY GATE</span><h3>安全完整性</h3></div><Tag intent={missingSafetySteps.length ? 'danger' : 'success'} minimal>{missingSafetySteps.length ? `${missingSafetySteps.length} 项缺口` : '通过'}</Tag></div>
              {missingSafetySteps.length ? missingSafetySteps.map((step) => (
                <button className="safety-row" key={step.id} onClick={() => setSelectedStepId(step.id)}><Icon icon="warning-sign" intent="danger" size={14} /><span><strong>{step.title}</strong><small>危险项缺少控制措施或安全说明</small></span></button>
              )) : <p className="muted">所有存在危险项的步骤都已填写控制措施和安全说明。</p>}
            </Card>

            <Card elevation={Elevation.ONE} className="gate-card">
              <div className="card-title"><div><span>RELEASE GATE</span><h3>提交与冻结</h3></div></div>
              <div className="gate-row"><span>来源版本</span><strong>{parentNode ? parentNode.version : '初始版本'}</strong></div>
              <div className="gate-row"><span>当前版本</span><strong>{draftVersion(activeNode)}</strong></div>
              <div className="gate-row"><span>复核状态</span><strong>{confirmedCount}/{activeNode.steps.length}</strong></div>
              <div className="gate-row"><span>安全缺口</span><strong className={missingSafetySteps.length ? 'danger-text' : ''}>{missingSafetySteps.length}</strong></div>
              <Divider />
              {readOnly ? (
                draftChildOf(activeNode.id)
                  ? <Button fill intent="warning" icon="git-branch" text={`继续修订稿 ${draftVersion(draftChildOf(activeNode.id)!)}`} onClick={() => activateNode(draftChildOf(activeNode.id)!.id)} />
                  : <Button fill intent="warning" icon="git-branch" text={`基于 ${activeNode.version} 建立修订稿`} onClick={() => startRevision(activeNode.id)} />
              ) : (
                <>
                  <Button fill intent="primary" icon="send-to" text="提交复核" onClick={submitForReview} />
                  <Button fill minimal icon="comparison" text="在版本树中查看本分支" onClick={() => setActiveView('compare')} />
                </>
              )}
            </Card>
          </aside>
        </main>
      )}

      {activeView === 'review' && (
        <main className="review-layout">
          <aside className="review-steps">
            <div className="panel-heading"><div><span>REVIEW QUEUE</span><h3>逐条复核</h3></div><Tag intent={pendingReviewCount ? 'warning' : 'success'}>{pendingReviewCount ? `${pendingReviewCount} 待处理` : '已完成'}</Tag></div>
            {activeNode.steps.map((step, index) => (
              <button key={step.id} className={`${step.id === selectedStep?.id ? 'selected' : ''} ${step.status}`} onClick={() => setSelectedStepId(step.id)}>
                <span>{String(index + 1).padStart(2, '0')}</span><div><strong>{step.title}</strong><small>{statusLabel(step.status)} · {draftVersion(activeNode)}</small></div><Icon icon={step.status === 'confirmed' ? 'tick-circle' : step.status === 'returned' ? 'undo' : 'circle'} size={15} />
              </button>
            ))}
          </aside>
          <section className="review-main">
            {readOnly && (
              <Callout intent="primary" icon="lock" title={`冻结版本 ${activeNode.version} 不可复核修改`}>
                批注与确认仅能在未冻结修订稿上进行。
                <div className="callout-actions">
                  <Button small icon="git-branch" intent="warning"
                    text={draftChildOf(activeNode.id) ? `继续修订稿 ${draftVersion(draftChildOf(activeNode.id)!)}` : `基于 ${activeNode.version} 建立修订稿`}
                    onClick={() => startRevision(activeNode.id)} />
                </div>
              </Callout>
            )}
            {selectedStep && (
              <>
                <Card elevation={Elevation.ONE} className="review-summary">
                  <div className="card-title"><div><span>SAFETY REVIEW</span><h3>{selectedStep.title}</h3></div><Tag intent={selectedStep.status === 'confirmed' ? 'success' : selectedStep.status === 'returned' ? 'danger' : 'warning'}>{statusLabel(selectedStep.status)}</Tag></div>
                  <div className="review-facts">
                    <div><span>预计时间</span><strong>{selectedStep.duration} 分钟</strong></div>
                    <div><span>材料与用量</span><strong>{selectedStep.materials} / {selectedStep.amount}</strong></div>
                    <div><span>危险项</span><strong>{selectedStep.hazards.join('、') || '无'}</strong></div>
                  </div>
                  <div className="review-section"><h4>控制措施</h4><p>{selectedStep.controls || '未填写'}</p></div>
                  <div className="review-section"><h4>安全说明</h4><p className={hasMissingSafety(selectedStep) ? 'danger-text' : ''}>{selectedStep.safetyNote || '未填写'}</p></div>
                  {hasMissingSafety(selectedStep) && <Callout intent="danger" icon="warning-sign">当前步骤存在安全信息缺口，不能确认或冻结版本。</Callout>}
                </Card>
                <Card elevation={Elevation.ONE} className="comment-card">
                  <div className="card-title"><div><span>REVIEW COMMENTS</span><h3>复核批注</h3></div><Tag minimal>{selectedStep.comments.length} 条</Tag></div>
                  <div className="comment-compose">
                    <TextArea fill disabled={readOnly} value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="填写具体依据、风险或修改建议…" />
                    <Button intent="primary" icon="comment" text="添加批注" disabled={readOnly || !commentText.trim()} onClick={addReviewComment} />
                  </div>
                  <div className="comment-list">
                    {selectedStep.comments.map((comment) => (
                      <article key={comment.id} className={comment.resolved ? 'resolved' : ''}>
                        <div className="comment-avatar">{comment.author.slice(0, 1)}</div>
                        <div><header><strong>{comment.author}</strong><span>{comment.role}</span><time>{formatDate(comment.createdAt)}</time></header><p>{comment.text}</p><Button minimal small disabled={readOnly} text={comment.resolved ? '已解决' : '标记解决'} icon={comment.resolved ? 'tick' : 'circle'} onClick={() => resolveComment(comment.id)} /></div>
                      </article>
                    ))}
                    {!selectedStep.comments.length && <p className="muted">当前步骤尚未添加复核批注。</p>}
                  </div>
                </Card>
              </>
            )}
          </section>
          <aside className="review-actions">
            <Card elevation={Elevation.ONE}>
              <div className="card-title"><div><span>REVIEWER ACTION</span><h3>复核决定</h3></div><Icon icon="endorsed" size={18} /></div>
              <p className="muted">确认后若修改该步骤，受影响的下游步骤会在编辑页重新提示。</p>
              <Button fill large intent="success" icon="tick" text="逐条确认" disabled={readOnly || hasMissingSafety(selectedStep)} onClick={() => setStepStatus('confirmed')} />
              <Button fill large icon="undo" text="退回修改" intent="warning" disabled={readOnly} onClick={() => setStepStatus('returned')} />
              <Button fill large minimal icon="refresh" text="恢复为待复核" disabled={readOnly} onClick={() => setStepStatus('submitted')} />
              <Divider />
              <div className="review-progress-list">
                {activeNode.steps.map((step) => <div key={step.id}><span>{step.title}</span><Tag minimal intent={step.status === 'confirmed' ? 'success' : step.status === 'returned' ? 'danger' : 'warning'}>{statusLabel(step.status)}</Tag></div>)}
              </div>
              <Button fill intent="primary" icon="lock" text="全部确认后冻结为子版本" onClick={openFreezeDialog} disabled={readOnly || !freezeReady} />
            </Card>
          </aside>
        </main>
      )}

      {activeView === 'compare' && (
        <main className="compare-layout">
          <Card elevation={Elevation.ONE} className="version-panel">
            <div className="card-title"><div><span>VERSION TREE</span><h3>版本树</h3></div><Tag minimal>{process.nodes.length} 个节点</Tag></div>
            <p className="muted tree-hint">每个冻结版本都可单独建立修订稿；同一来源仅保留一份未冻结修订，冻结后成为该来源下的子版本。点击节点查看分支内容。</p>
            <div className="version-tree">
              {treeEntries.map(({ node, depth }) => {
                const draftChild = draftChildOf(node.id);
                const childCount = process.nodes.filter((item) => item.parentId === node.id).length;
                return (
                  <div className="tree-node-slot" key={node.id} style={{ marginLeft: depth * 16 }}>
                    {depth > 0 && <span className="tree-guide" />}
                    <article className={`tree-row ${node.id === activeNode.id ? 'active' : ''} ${node.frozen ? 'frozen' : 'draft'}`}>
                      <button className="tree-row-body" onClick={() => activateNode(node.id)}>
                        <Icon icon={node.frozen ? 'lock' : 'git-branch'} size={15} intent={node.frozen ? 'primary' : 'warning'} />
                        <span className="tree-copy">
                          <span className="tree-line"><b>{draftVersion(node)}</b>
                            <Tag minimal intent={node.frozen ? 'success' : 'warning'}>{node.frozen ? '已冻结' : '未冻结'}</Tag>
                            {node.id === activeNode.id && <Tag minimal intent="primary">当前</Tag>}
                          </span>
                          <strong>{node.label}</strong>
                          <small>{formatDate(node.createdAt)} · {node.steps.length} 步 · {node.author}{childCount ? ` · ${childCount} 个分支` : ''}</small>
                          {node.note && <em>{node.frozen && node.parentId ? `改动摘要：${node.note}` : node.note}</em>}
                        </span>
                      </button>
                      <span className="tree-ops">
                        {node.frozen ? (
                          <Button minimal small icon="git-branch"
                            title={draftChild ? '继续该版本的未冻结修订稿' : '基于该冻结版本建立修订稿'}
                            text={draftChild ? '继续修订' : '建立修订'}
                            onClick={() => startRevision(node.id)} />
                        ) : (
                          <Button minimal small icon="edit" text="继续修订" disabled={node.id === activeNode.id} onClick={() => activateNode(node.id)} />
                        )}
                        <Button minimal small icon="comparison" title="与来源版本比较" onClick={() => compareFromNode(node.id)} />
                      </span>
                    </article>
                  </div>
                );
              })}
            </div>
          </Card>
          <Card elevation={Elevation.ONE} className="diff-panel">
            <div className="card-title"><div><span>VERSION DIFF</span><h3>流程差异比较</h3></div><div className="diff-selects">
              <HTMLSelect value={compareBaseId} onChange={(event) => setCompareBaseId(event.target.value)}>{treeEntries.map(({ node }) => <option key={node.id} value={node.id}>{draftVersion(node)} · 基准</option>)}</HTMLSelect>
              <Icon icon="arrow-right" />
              <HTMLSelect value={compareTargetId} onChange={(event) => setCompareTargetId(event.target.value)}>{treeEntries.map(({ node }) => <option key={node.id} value={node.id}>{draftVersion(node)} · 目标</option>)}</HTMLSelect>
            </div></div>
            <div className="diff-table">
              <div className="diff-head"><span>变更类型</span><span>步骤</span><span>具体内容</span></div>
              {versionDiff.map((diff) => <div className={`diff-row ${diff.kind}`} key={diff.id}><Tag minimal intent={diff.kind === 'added' ? 'success' : diff.kind === 'removed' ? 'danger' : 'primary'}>{diff.kind === 'added' ? '新增' : diff.kind === 'removed' ? '删除' : '修改'}</Tag><strong>{diff.title}</strong><p>{diff.detail}</p></div>)}
              {!versionDiff.length && <div className="empty-diff"><Icon icon="comparison" size={30} /><strong>两个版本没有差异</strong><p>请选择不同节点，或先从某个冻结版本建立修订稿。</p></div>}
            </div>
          </Card>
          <Card elevation={Elevation.ONE} className="freeze-rules">
            <div className="card-title"><div><span>FREEZE RULES</span><h3>冻结检查</h3></div><Tag minimal intent={readOnly ? 'none' : freezeReady ? 'success' : 'warning'}>{readOnly ? '只读' : freezeReady ? '可冻结' : '未达标'}</Tag></div>
            <div className={confirmedCount === activeNode.steps.length ? 'passed' : ''}><Icon icon={confirmedCount === activeNode.steps.length ? 'tick-circle' : 'circle'} /><span><strong>所有步骤已确认</strong><small>{confirmedCount}/{activeNode.steps.length}</small></span></div>
            <div className={!missingSafetySteps.length ? 'passed' : ''}><Icon icon={!missingSafetySteps.length ? 'tick-circle' : 'circle'} /><span><strong>安全信息完整</strong><small>{missingSafetySteps.length} 个缺口</small></span></div>
            <div className={activeNode.steps.every((step) => step.dependencies.every((id) => activeNode.steps.some((item) => item.id === id))) ? 'passed' : ''}><Icon icon="git-merge" /><span><strong>依赖引用有效</strong><small>{activeNode.steps.reduce((sum, step) => sum + step.dependencies.length, 0)} 条依赖</small></span></div>
            <div><Icon icon="diagram-tree" /><span><strong>父子分支关系</strong><small>{parentNode ? `源自 ${parentNode.version}，冻结后成为其子版本` : '初始版本'}</small></span></div>
            {readOnly ? (
              <Button fill intent="warning" icon="git-branch"
                text={draftChildOf(activeNode.id) ? `继续修订稿 ${draftVersion(draftChildOf(activeNode.id)!)}` : `基于 ${activeNode.version} 建立修订稿`}
                onClick={() => startRevision(activeNode.id)} />
            ) : (
              <Button fill intent="primary" icon="lock" text={`冻结为 ${activeNode.version}`} onClick={openFreezeDialog} disabled={!freezeReady} />
            )}
          </Card>
        </main>
      )}

      <Dialog isOpen={freezeOpen} onClose={() => setFreezeOpen(false)} title={`冻结修订稿 · 形成子版本 ${activeNode.version}`} icon="lock" className="freeze-dialog">
        <div className="freeze-dialog-body">
          <p className="freeze-source">来源版本 <b>{parentNode?.version ?? '—'}</b> 的修订稿冻结后，将作为其下的子版本保存，分支关系与本摘要一并写入本地数据。</p>
          <FormGroup label="本次改动摘要" labelFor="freeze-note" labelInfo="（可编辑）">
            <TextArea id="freeze-note" fill rows={6} value={freezeNote} onChange={(event) => setFreezeNote(event.target.value)} placeholder="概述本次修订相对来源版本的改动…" />
          </FormGroup>
          <Callout intent="warning" icon="warning-sign" minimal>
            冻结后该节点内容不可再修改；如需改动，请从该冻结版本再建立新的修订稿。
          </Callout>
        </div>
        <div className="freeze-dialog-footer">
          <Button text="取消" onClick={() => setFreezeOpen(false)} />
          <Button intent="primary" icon="lock" text="确认冻结" onClick={confirmFreeze} />
        </div>
      </Dialog>

      <footer className="app-footer">
        <span>所有实验数据与版本树分支关系仅保存在当前浏览器 localStorage，重新打开页面不会丢失。</span>
        <span>Ctrl/Cmd + Z 撤销 · Ctrl/Cmd + Y 重做 · Ctrl/Cmd + S 保存</span>
      </footer>
    </div>
  );
}

function hasMissingSafety(step: ProcessStep): boolean {
  return step.hazards.length > 0 && (!step.controls.trim() || !step.safetyNote.trim());
}

function collectDownstream(steps: ProcessStep[], sourceId: string | null): string[] {
  if (!sourceId) return [];
  const result = new Set<string>();
  const visit = (id: string) => {
    steps.filter((step) => step.dependencies.includes(id)).forEach((step) => {
      if (result.has(step.id)) return;
      result.add(step.id);
      visit(step.id);
    });
  };
  visit(sourceId);
  return [...result];
}

function changedFields(before: ProcessStep, after: ProcessStep): string[] {
  const fields: string[] = [];
  if (before.title !== after.title) fields.push('名称');
  if (before.purpose !== after.purpose) fields.push('目的');
  if (before.materials !== after.materials || before.amount !== after.amount) fields.push('材料或用量');
  if (before.equipment !== after.equipment) fields.push('设备');
  if (before.duration !== after.duration) fields.push('预计时间');
  if (JSON.stringify(before.hazards) !== JSON.stringify(after.hazards)) fields.push('危险项');
  if (before.controls !== after.controls || before.safetyNote !== after.safetyNote) fields.push('安全控制');
  if (JSON.stringify(before.dependencies) !== JSON.stringify(after.dependencies)) fields.push('依赖关系');
  if (before.expectedResult !== after.expectedResult) fields.push('预期结果');
  return fields;
}

function compareNodeSteps(nodes: VersionNode[], baseId: string, targetId: string): DiffItem[] {
  const base = nodes.find((node) => node.id === baseId);
  const target = nodes.find((node) => node.id === targetId);
  if (!base || !target) return [];
  const diffs: DiffItem[] = [];
  const targetMap = new Map(target.steps.map((step) => [step.id, step]));
  const baseMap = new Map(base.steps.map((step) => [step.id, step]));
  base.steps.forEach((step) => {
    if (!targetMap.has(step.id)) diffs.push({ id: step.id, title: step.title, kind: 'removed', detail: `目标版本（${target.version}）已删除该步骤。` });
  });
  target.steps.forEach((step) => {
    const before = baseMap.get(step.id);
    if (!before) {
      diffs.push({ id: step.id, title: step.title, kind: 'added', detail: `${step.duration} 分钟；危险项：${step.hazards.join('、') || '无'}` });
      return;
    }
    const fields = changedFields(before, step);
    if (fields.length) diffs.push({ id: step.id, title: step.title, kind: 'changed', detail: `变化字段：${fields.join('、')}。` });
  });
  return diffs;
}

/** 依据与来源版本的字段差异，生成冻结时的改动摘要初稿。 */
function summarizeChanges(parentSteps: ProcessStep[], steps: ProcessStep[]): string {
  const parentMap = new Map(parentSteps.map((step) => [step.id, step]));
  const currentMap = new Map(steps.map((step) => [step.id, step]));
  const added = steps.filter((step) => !parentMap.has(step.id));
  const removed = parentSteps.filter((step) => !currentMap.has(step.id));
  const changed = steps
    .map((step) => ({ step, fields: parentMap.get(step.id) ? changedFields(parentMap.get(step.id)!, step) : [] }))
    .filter((item) => item.fields.length);
  const parts: string[] = [];
  if (added.length) parts.push(`新增 ${added.length} 个步骤：${added.map((step) => step.title).join('、')}`);
  if (removed.length) parts.push(`删除 ${removed.length} 个步骤：${removed.map((step) => step.title).join('、')}`);
  if (changed.length) parts.push(`修改 ${changed.length} 个步骤：${changed.map((item) => `${item.step.title}（${item.fields.join('、')}）`).join('；')}`);
  return parts.length ? parts.join('；') : '相对来源版本未检测到步骤字段变化。';
}

export default App;
