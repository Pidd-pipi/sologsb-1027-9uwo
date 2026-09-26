import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Button,
  Callout,
  Card,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
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
type DraftStatus = 'draft' | 'in-review' | 'revising';
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

interface VersionSnapshot {
  id: string;
  label: string;
  version: string;
  createdAt: string;
  /** 父版本 ID；首版为空串。修订稿冻结后记录其来源版本，形成版本树。 */
  parentId: string;
  /** 本次冻结相对来源版本的改动摘要。 */
  changeSummary: string;
  author: string;
  steps: ProcessStep[];
}

interface DraftRevision {
  id: string;
  label: string;
  /** 派生来源的冻结版本 ID；首条主干修订稿为空串。 */
  sourceVersionId: string;
  status: DraftStatus;
  steps: ProcessStep[];
  createdAt: string;
  updatedAt: string;
}

interface ExperimentWorkspace {
  id: string;
  title: string;
  code: string;
  objective: string;
  principal: string;
  lab: string;
  /** 冻结版本节点，按 parentId 构成版本树。 */
  versions: VersionSnapshot[];
  /** 全部未冻结修订稿，每个来源版本最多一条。 */
  drafts: DraftRevision[];
  activeDraftId: string;
  updatedAt: string;
}

interface HistoryState {
  past: ExperimentWorkspace[];
  present: ExperimentWorkspace;
  future: ExperimentWorkspace[];
}

interface DiffItem {
  id: string;
  title: string;
  kind: 'added' | 'removed' | 'changed';
  detail: string;
  fields: string[];
}

/** 可比较的快照（冻结版本或未冻结修订稿）。 */
interface SnapshotEntry {
  id: string;
  kind: 'version' | 'draft';
  label: string;
  version: string;
  createdAt: string;
  steps: ProcessStep[];
}

const STORAGE_KEY = 'sologsb-1027-lab-safety-v1';
const CURRENT_AUTHOR = '周宁';
const CURRENT_ROLE = '安全复核员';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function seedSteps(): ProcessStep[] {
  return [
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
}

function initialWorkspace(): ExperimentWorkspace {
  const baseSteps = seedSteps();
  const firstVersion: VersionSnapshot = {
    id: 'version-1-0', label: '首版批准流程', version: '1.0.0', parentId: '',
    createdAt: '2026-09-20T14:30:00+08:00', changeSummary: '建立基础反应与取样步骤。', author: '王颖',
    steps: clone(baseSteps).slice(0, 4).map((step) => ({ ...step, status: 'confirmed' as StepStatus, comments: [] }))
  };
  const secondVersion: VersionSnapshot = {
    id: 'version-1-1', label: '补充冷却与废液步骤', version: '1.1.0', parentId: 'version-1-0',
    createdAt: '2026-09-24T15:10:00+08:00', changeSummary: '增加安全冷却、废液处置和现场恢复。', author: '王颖',
    steps: clone(baseSteps).map((step) => ({ ...step, status: 'confirmed' as StepStatus, comments: [] }))
  };
  const mainDraft: DraftRevision = {
    id: 'draft-main', label: '主干修订稿', sourceVersionId: 'version-1-1', status: 'in-review',
    steps: baseSteps, createdAt: '2026-09-24T15:30:00+08:00', updatedAt: new Date().toISOString()
  };

  return {
    id: 'exp-catalyst-2026-09', title: '负载型催化剂评价实验', code: 'SAFE-CAT-026',
    objective: '在受控温度下评价催化剂活性，并完整记录过程样品与安全控制措施。',
    principal: '李明', lab: '材料化学实验室 B-207',
    versions: [firstVersion, secondVersion], drafts: [mainDraft],
    activeDraftId: mainDraft.id, updatedAt: new Date().toISOString()
  };
}

/** 兼容旧版单工作区数据：把旧流程迁移为版本树 + 修订稿结构。 */
function migrateWorkspace(parsed: Partial<ExperimentWorkspace>): ExperimentWorkspace | null {
  // 已经是新结构（允许没有打开的修订稿，即 activeDraftId 为空）
  if (parsed.id && Array.isArray(parsed.versions) && Array.isArray(parsed.drafts)) {
    const versions = parsed.versions as VersionSnapshot[];
    const drafts = parsed.drafts as DraftRevision[];
    const shapeOk = versions.every((item) => typeof item.parentId === 'string' && typeof item.changeSummary === 'string')
      && drafts.every((item) => Array.isArray(item.steps) && typeof item.sourceVersionId === 'string');
    const activeOk = !parsed.activeDraftId || drafts.some((item) => item.id === parsed.activeDraftId);
    if (shapeOk && activeOk) return parsed as ExperimentWorkspace;
  }
  // 旧结构迁移
  const legacy = parsed as {
    id?: string; title?: string; code?: string; objective?: string; principal?: string; lab?: string;
    status?: string;
    steps?: ProcessStep[];
    versions?: Array<{
      id: string; label: string; version: string; createdAt: string; author: string; steps: ProcessStep[];
      note?: string; changeSummary?: string;
    }>;
  };
  if (!legacy.id || !Array.isArray(legacy.steps) || !Array.isArray(legacy.versions)) return null;
  const versions: VersionSnapshot[] = legacy.versions.map((item, index, all) => ({
    id: item.id, label: item.label, version: item.version, createdAt: item.createdAt, author: item.author,
    steps: item.steps,
    parentId: index > 0 ? (all[index - 1]?.id ?? '') : '',
    changeSummary: item.changeSummary ?? item.note ?? '由旧版数据迁移。'
  }));
  const base: ExperimentWorkspace = {
    id: legacy.id, title: legacy.title ?? '', code: legacy.code ?? '', objective: legacy.objective ?? '',
    principal: legacy.principal ?? '', lab: legacy.lab ?? '', versions, drafts: [],
    activeDraftId: '', updatedAt: new Date().toISOString()
  };
  if (legacy.status === 'frozen' || !legacy.steps.length) {
    return base;
  }
  const sourceVersionId = versions.at(-1)?.id ?? '';
  const draft = makeDraft(sourceVersionId, legacy.steps, legacy.status === 'in-review' ? 'in-review' : 'revising');
  draft.label = '迁移修订稿';
  base.drafts.push(draft);
  base.activeDraftId = draft.id;
  return base;
}

function loadWorkspace(): ExperimentWorkspace {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return initialWorkspace();
    const parsed = JSON.parse(value) as Partial<ExperimentWorkspace>;
    return migrateWorkspace(parsed) ?? initialWorkspace();
  } catch {
    return initialWorkspace();
  }
}

function historyReducer(state: HistoryState, action:
  | { type: 'commit'; update: (draft: ExperimentWorkspace) => void }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; value: ExperimentWorkspace }
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

function splitList(value: string): string[] {
  return value.split(/[\n,，、;；]+/).map((item) => item.trim()).filter(Boolean);
}

function statusLabel(status: StepStatus): string {
  return status === 'confirmed' ? '已确认' : status === 'returned' ? '已退回' : status === 'submitted' ? '待复核' : '草稿';
}

function draftStatusLabel(status: DraftStatus): string {
  return status === 'in-review' ? '复核中' : status === 'revising' ? '修订中' : '草稿';
}

function draftProgressLabel(draft: DraftRevision): string {
  const total = draft.steps.length;
  const confirmed = draft.steps.filter((step) => step.status === 'confirmed').length;
  if (total > 0 && confirmed === total) return '待冻结';
  const pending = draft.steps.filter((step) => step.status === 'submitted' || step.status === 'returned').length;
  return pending ? `复核中 · ${confirmed}/${total}` : `修订中 · ${confirmed}/${total}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

/**
 * 计算来源版本下一个子版本号：
 * - X.Y.0 的分支修订：X.Y.1、X.Y.2…（与主线子版本 X.(Y+1).0 处于不同命名空间，互不冲突）
 * - X.Y.Z（Z>0）的继续分支：X.Y.Z.1、X.Y.Z.2…
 */
function nextChildVersion(versions: VersionSnapshot[], parentId: string, fallbackParentVersion: string): string {
  const parent = versions.find((item) => item.id === parentId);
  if (!parent) {
    // 根级冻结（来源版本缺失）：延续所有版本中最新的主线次版本号
    const matches = versions
      .map((item) => item.version.match(/^(\d+)\.(\d+)/))
      .filter((match): match is RegExpMatchArray => !!match);
    const fallback = fallbackParentVersion.match(/^(\d+)\.(\d+)/);
    if (fallback) matches.push(fallback);
    const major = matches.length ? Math.max(...matches.map((match) => Number(match[1]))) : 1;
    const minors = matches.filter((match) => Number(match[1]) === major).map((match) => Number(match[2]));
    return `${major}.${minors.length ? Math.max(...minors) + 1 : 1}.0`;
  }
  const parts = parent.version.split('.');
  if (Number(parts.at(-1)) === 0) {
    const prefix = `${parts.slice(0, -1).join('.')}.`;
    const usedPatch = versions
      .filter((item) => item.parentId === parentId)
      .map((item) => item.version)
      .filter((version) => version.startsWith(prefix) && version.split('.').length === parts.length)
      .map((version) => Number(version.split('.').at(-1)));
    return `${prefix}${Math.max(0, ...usedPatch) + 1}`;
  }
  return `${parent.version}.${versions.filter((item) => item.parentId === parentId).length + 1}`;
}

/** 新修订稿的工作版本号（冻结前显示）。 */
function draftVersionTag(source: VersionSnapshot | undefined): string {
  const base = source?.version ?? '1.0.0';
  const parts = base.split('.');
  if (parts.at(-1) === '0') {
    return `${parts.slice(0, -1).join('.')}.1-draft`;
  }
  return `${base}.1-draft`;
}

function makeDraft(sourceVersionId: string, sourceSteps: ProcessStep[], status: DraftStatus): DraftRevision {
  const now = new Date().toISOString();
  return {
    id: uid('draft'),
    label: sourceVersionId ? '修订稿' : '主干修订稿',
    sourceVersionId,
    status,
    steps: clone(sourceSteps).map((step) => ({ ...step, status: 'draft' as StepStatus, comments: [] })),
    createdAt: now,
    updatedAt: now
  };
}

/** 构造可比较快照索引。 */
function buildSnapshotEntries(workspace: ExperimentWorkspace): SnapshotEntry[] {
  const versions: SnapshotEntry[] = workspace.versions.map((version) => ({
    id: version.id, kind: 'version' as const, label: version.label,
    version: version.version, createdAt: version.createdAt, steps: version.steps
  }));
  const drafts: SnapshotEntry[] = workspace.drafts.map((draft) => {
    const source = workspace.versions.find((version) => version.id === draft.sourceVersionId);
    return {
      id: draft.id, kind: 'draft' as const, label: draft.label,
      version: draftVersionTag(source), createdAt: draft.updatedAt, steps: draft.steps
    };
  });
  return [...versions, ...drafts];
}

function snapshotLabel(entry: SnapshotEntry): string {
  return entry.kind === 'version' ? `${entry.version} · 冻结` : `${entry.version} · 修订稿`;
}

/** 快照的来源版本描述。 */
function snapshotSourceLabel(workspace: ExperimentWorkspace, entry: SnapshotEntry): string {
  if (entry.kind === 'version') {
    const version = workspace.versions.find((item) => item.id === entry.id);
    if (!version?.parentId) return '首版（根版本）';
    const parent = workspace.versions.find((item) => item.id === version.parentId);
    return `父版本 ${parent?.version ?? '未知版本'}`;
  }
  const draft = workspace.drafts.find((item) => item.id === entry.id);
  const source = workspace.versions.find((item) => item.id === draft?.sourceVersionId);
  return `派生自 ${source?.version ?? '首版'}`;
}

function App() {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => ({ past: [], present: loadWorkspace(), future: [] }));
  const workspace = history.present;
  const activeDraft = workspace.drafts.find((draft) => draft.id === workspace.activeDraftId);
  const steps = activeDraft?.steps ?? [];
  const [selectedStepId, setSelectedStepId] = useState(steps[0]?.id ?? '');
  const [activeView, setActiveView] = useState<ViewId>('editor');
  const [lastModifiedId, setLastModifiedId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [savedLabel, setSavedLabel] = useState('本地数据已载入');
  const [online, setOnline] = useState(true);
  const [compareBaseId, setCompareBaseId] = useState(workspace.versions.at(-2)?.id ?? workspace.versions[0]?.id ?? '');
  const [compareTargetId, setCompareTargetId] = useState(workspace.versions.at(-1)?.id ?? workspace.drafts[0]?.id ?? '');
  const [viewSnapshotId, setViewSnapshotId] = useState<string | null>(null);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [freezeNote, setFreezeNote] = useState('');
  const initialSaveSkipped = useRef(false);

  const selectedStep = steps.find((step) => step.id === selectedStepId) ?? steps[0];
  const snapshotEntries = useMemo(() => buildSnapshotEntries(workspace), [workspace]);
  const downstreamIds = useMemo(() => collectDownstream(steps, lastModifiedId), [steps, lastModifiedId]);
  const impactedSteps = steps.filter((step) => downstreamIds.includes(step.id));
  const missingSafetySteps = steps.filter(hasMissingSafety);
  const pendingReviewCount = steps.filter((step) => step.status === 'submitted' || step.status === 'returned').length;
  const confirmedCount = steps.filter((step) => step.status === 'confirmed').length;
  const reviewProgress = steps.length ? Math.round((confirmedCount / steps.length) * 100) : 0;
  const versionTree = useMemo(() => buildVersionTree(workspace), [workspace]);
  const snapshotDiff = useMemo(
    () => compareSnapshotSteps(snapshotEntries, compareBaseId, compareTargetId),
    [snapshotEntries, compareBaseId, compareTargetId]
  );
  const activeSource = workspace.versions.find((version) => version.id === activeDraft?.sourceVersionId);
  const activeVersionTag = draftVersionTag(activeSource);
  const freezeCandidateNumber = activeDraft
    ? nextChildVersion(workspace.versions, activeDraft.sourceVersionId, activeSource?.version ?? '1.0.0')
    : '';
  /** 当前修订稿相对来源版本的差异，用于生成建议的改动摘要。 */
  const revisionDiff = useMemo(
    () => (activeDraft ? compareStepLists(activeSource?.steps ?? [], activeDraft.steps) : []),
    [activeDraft, activeSource]
  );
  const suggestedSummary = useMemo(() => summarizeDiff(revisionDiff), [revisionDiff]);
  const canFreeze = !!activeDraft
    && steps.length > 0
    && steps.every((step) => step.status === 'confirmed')
    && missingSafetySteps.length === 0;
  const viewSnapshot = viewSnapshotId
    ? snapshotEntries.find((entry) => entry.id === viewSnapshotId) ?? null
    : null;

  useEffect(() => {
    if (!initialSaveSkipped.current) {
      initialSaveSkipped.current = true;
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    setSavedLabel(`自动保存 · ${formatDate(new Date().toISOString())}`);
  }, [workspace]);

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

  const persistManually = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    setSavedLabel(`手动保存 · ${formatDate(new Date().toISOString())}`);
  };

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
        persistManually();
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [workspace]);

  const commitWorkspace = (update: (draft: ExperimentWorkspace) => void): void => {
    dispatch({ type: 'commit', update });
  };

  /** 只修改当前修订稿，并顺带刷新修订稿的 updatedAt。 */
  const commitDraft = (update: (draft: DraftRevision, workspace: ExperimentWorkspace) => void): void => {
    const draftId = activeDraft?.id;
    if (!draftId) return;
    commitWorkspace((workspaceDraft) => {
      const target = workspaceDraft.drafts.find((item) => item.id === draftId);
      if (!target) return;
      update(target, workspaceDraft);
      target.updatedAt = new Date().toISOString();
    });
  };

  const updateWorkspaceField = (field: 'title' | 'code' | 'objective' | 'principal' | 'lab', value: string): void => {
    commitWorkspace((draft) => { draft[field] = value; });
  };

  const updateStep = (field: keyof ProcessStep, value: unknown): void => {
    if (!selectedStep) return;
    const id = selectedStep.id;
    setLastModifiedId(id);
    commitDraft((draft) => {
      const step = draft.steps.find((item) => item.id === id);
      if (step) (step as unknown as Record<string, unknown>)[field] = value;
    });
  };

  const updateStepList = (field: 'hazards' | 'dependencies', value: string): void => {
    updateStep(field, splitList(value));
  };

  const addStep = (): void => {
    if (!activeDraft) return;
    const id = uid('step');
    commitDraft((draft) => {
      draft.steps.push({
        id, title: '新的实验步骤', purpose: '', materials: '', equipment: '', amount: '', duration: 10,
        hazards: [], controls: '', dependencies: draft.steps.at(-1) ? [draft.steps.at(-1)!.id] : [],
        safetyNote: '', expectedResult: '', status: 'draft', comments: []
      });
    });
    setSelectedStepId(id);
    setLastModifiedId(id);
    setActiveView('editor');
  };

  const duplicateStep = (): void => {
    if (!selectedStep || !activeDraft) return;
    const copy: ProcessStep = clone(selectedStep);
    copy.id = uid('step');
    copy.title = `${copy.title}（副本）`;
    copy.status = 'draft';
    copy.comments = [];
    copy.dependencies = [...copy.dependencies];
    commitDraft((draft) => {
      const index = draft.steps.findIndex((step) => step.id === selectedStep.id);
      draft.steps.splice(index + 1, 0, copy);
    });
    setSelectedStepId(copy.id);
  };

  const deleteStep = (): void => {
    if (!selectedStep || !activeDraft || steps.length <= 1) return;
    const id = selectedStep.id;
    commitDraft((draft) => {
      draft.steps = draft.steps.filter((step) => step.id !== id);
      draft.steps.forEach((step) => { step.dependencies = step.dependencies.filter((dependency) => dependency !== id); });
    });
    setSelectedStepId(steps.find((step) => step.id !== id)?.id ?? '');
  };

  const moveStep = (direction: -1 | 1): void => {
    if (!selectedStep || !activeDraft) return;
    const id = selectedStep.id;
    commitDraft((draft) => {
      const index = draft.steps.findIndex((step) => step.id === id);
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= draft.steps.length) return;
      const [step] = draft.steps.splice(index, 1);
      draft.steps.splice(nextIndex, 0, step);
    });
    setLastModifiedId(id);
  };

  const toggleDependency = (dependencyId: string, checked: boolean): void => {
    if (!selectedStep) return;
    const next = checked
      ? [...new Set([...selectedStep.dependencies, dependencyId])]
      : selectedStep.dependencies.filter((id) => id !== dependencyId);
    updateStep('dependencies', next);
  };

  const submitForReview = (): void => {
    if (!activeDraft) return;
    commitDraft((draft) => {
      draft.status = 'in-review';
      draft.steps.forEach((step) => {
        if (step.status !== 'confirmed') step.status = 'submitted';
      });
    });
    setActiveView('review');
    setSavedLabel('修订稿已提交复核');
  };

  const addReviewComment = (): void => {
    if (!selectedStep || !commentText.trim()) return;
    const id = selectedStep.id;
    commitDraft((draft) => {
      const step = draft.steps.find((item) => item.id === id);
      step?.comments.push({
        id: uid('comment'), author: CURRENT_AUTHOR, role: CURRENT_ROLE,
        text: commentText.trim(), createdAt: new Date().toISOString(), resolved: false
      });
    });
    setCommentText('');
  };

  const setStepStatus = (status: StepStatus): void => {
    if (!selectedStep) return;
    updateStep('status', status);
    setLastModifiedId(status === 'returned' ? selectedStep.id : null);
  };

  const resolveComment = (commentId: string): void => {
    if (!selectedStep) return;
    const stepId = selectedStep.id;
    commitDraft((draft) => {
      const comment = draft.steps.find((step) => step.id === stepId)?.comments.find((item) => item.id === commentId);
      if (comment) comment.resolved = !comment.resolved;
    });
  };

  /** 切换到另一修订稿并进入编辑页；重置撤销栈，避免跨分支互相覆盖。 */
  const switchDraft = (draftId: string): void => {
    const target = workspace.drafts.find((draft) => draft.id === draftId);
    if (!target) return;
    if (draftId !== workspace.activeDraftId) {
      const next = clone(workspace);
      next.activeDraftId = draftId;
      dispatch({ type: 'reset', value: next });
      setSelectedStepId(target.steps[0]?.id ?? '');
      setLastModifiedId(null);
      setSavedLabel(`已切换到「${target.label}」`);
    }
    setActiveView('editor');
  };

  /** 从任意冻结版本建立修订稿；同一来源只允许一份未冻结修订。 */
  const createRevision = (sourceVersionId: string): void => {
    const source = workspace.versions.find((version) => version.id === sourceVersionId);
    if (!source) return;
    const existing = workspace.drafts.find((draft) => draft.sourceVersionId === sourceVersionId);
    if (existing) {
      switchDraft(existing.id);
      setActiveView('editor');
      setSavedLabel(`「${source.version}」已有未冻结修订稿，已切换`);
      return;
    }
    const draft = makeDraft(sourceVersionId, source.steps, 'revising');
    draft.label = `${source.version} 修订稿`;
    const next = clone(workspace);
    next.drafts.push(draft);
    next.activeDraftId = draft.id;
    dispatch({ type: 'reset', value: next });
    setSelectedStepId(draft.steps[0]?.id ?? '');
    setLastModifiedId(null);
    setActiveView('editor');
    setSavedLabel(`已从冻结版本 ${source.version} 建立修订稿`);
  };

  const openFreezeDialog = (): void => {
    if (!canFreeze) return;
    setFreezeNote(suggestedSummary);
    setFreezeOpen(true);
  };

  const closeFreezeDialog = (): void => {
    setFreezeOpen(false);
    setFreezeNote('');
  };

  /** 修订稿冻结：成为来源版本下的子版本，记录改动摘要，原修订稿关闭。 */
  const confirmFreeze = (): void => {
    if (!activeDraft || !canFreeze || !freezeNote.trim()) return;
    const sourceVersionId = activeDraft.sourceVersionId;
    const frozenSteps = clone(activeDraft.steps);
    const summary = freezeNote.trim();
    const frozenVersionId = uid('version');
    const remainingDraftId = workspace.drafts.find((draft) => draft.id !== activeDraft.id)?.id ?? '';
    const remainingFirstStepId = workspace.drafts.find((draft) => draft.id === remainingDraftId)?.steps[0]?.id ?? '';
    let frozenNumber = '';
    commitWorkspace((draft) => {
      frozenNumber = nextChildVersion(draft.versions, sourceVersionId, draft.versions.find((item) => item.id === sourceVersionId)?.version ?? '1.0.0');
      draft.versions.push({
        id: frozenVersionId, label: '修订稿冻结版', version: frozenNumber, parentId: sourceVersionId,
        createdAt: new Date().toISOString(), changeSummary: summary, author: CURRENT_AUTHOR, steps: frozenSteps
      });
      draft.drafts = draft.drafts.filter((item) => item.id !== activeDraft.id);
      draft.activeDraftId = remainingDraftId;
    });
    setSelectedStepId(remainingFirstStepId);
    setCompareBaseId(sourceVersionId || workspace.versions[0]?.id || frozenVersionId);
    setCompareTargetId(frozenVersionId);
    closeFreezeDialog();
    setSavedLabel(`子版本 ${frozenNumber} 已冻结并挂到来源版本下`);
    setActiveView('compare');
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-icon"><Icon icon="lab-test" size={23} /></div>
          <div><h1>实验流程安全复核台</h1><p>版本分支修订 · 逐条复核 · 冻结版本树</p></div>
        </div>
        <div className="header-status">
          <span className={`network ${online ? 'online' : ''}`}></span>
          <span>{online ? '离线保存已启用' : '当前离线，修改仍会保存'}</span>
          <strong>{savedLabel}</strong>
        </div>
        <div className="header-actions">
          <Button icon="undo" text="撤销" minimal disabled={history.past.length === 0} onClick={() => dispatch({ type: 'undo' })} />
          <Button icon="redo" text="重做" minimal disabled={history.future.length === 0} onClick={() => dispatch({ type: 'redo' })} />
          <Button icon="floppy-disk" text="手动保存" onClick={persistManually} />
          <Button icon="lock" text="冻结修订稿" intent="primary" onClick={openFreezeDialog} disabled={!canFreeze} />
        </div>
      </header>

      {!online && <Callout className="offline-callout" intent="warning" icon="cloud">网络不可用。编辑、复核和版本分支关系仍会保存在当前浏览器。</Callout>}

      <section className="process-banner">
        <div className="banner-main">
          <div className="code-line">
            <span>{workspace.code}</span>
            {activeDraft
              ? <Tag minimal>{draftStatusLabel(activeDraft.status)}</Tag>
              : <Tag minimal intent="none">仅查看版本树</Tag>}
          </div>
          <h2>{workspace.title}</h2>
          <p>{workspace.objective}</p>
        </div>
        <div className="banner-meta">
          <div><span>负责人</span><strong>{workspace.principal}</strong></div>
          <div><span>实验区域</span><strong>{workspace.lab}</strong></div>
          <div><span>当前修订稿</span><strong>{activeDraft ? activeDraft.label : '无未冻结修订'}</strong></div>
        </div>
        <div className="banner-progress">
          <div><span>工作版本 / 来源</span><strong>{activeDraft ? `${activeVersionTag} ← ${activeSource?.version ?? '首版'}` : '—'}</strong></div>
          <ProgressBar value={reviewProgress / 100} intent={reviewProgress === 100 ? 'success' : 'primary'} stripes={reviewProgress < 100} />
          <small>{activeDraft ? `${pendingReviewCount ? `${pendingReviewCount} 条待处理 · ` : ''}${missingSafetySteps.length} 条安全缺口 · ${draftProgressLabel(activeDraft)}` : `共 ${workspace.versions.length} 个冻结版本`}</small>
        </div>
      </section>

      <Tabs id="workspace-tabs" selectedTabId={activeView} onChange={(value) => setActiveView(value as ViewId)} renderActiveTabPanelOnly className="workspace-tabs">
        <Tab id="editor" title={<span><Icon icon="edit" /> 流程编写</span>} />
        <Tab id="review" title={<span><Icon icon="endorsed" /> 安全复核 {pendingReviewCount > 0 && <b className="tab-badge">{pendingReviewCount}</b>}</span>} />
        <Tab id="compare" title={<span><Icon icon="diagram-tree" /> 版本树与比较</span>} />
      </Tabs>

      {activeView === 'editor' && (
        activeDraft && selectedStep ? (
          <main className="editor-layout">
            <aside className="step-panel">
              <div className="panel-heading">
                <div><span>PROCESS STEPS</span><h3>{activeDraft.label}</h3></div>
                <Button icon="add" minimal small onClick={addStep} />
              </div>
              <div className="step-list">
                {steps.map((step, index) => (
                  <button key={step.id} className={step.id === selectedStep.id ? 'selected' : ''} onClick={() => setSelectedStepId(step.id)}>
                    <span className={`step-number ${step.status}`}>{String(index + 1).padStart(2, '0')}</span>
                    <span className="step-copy"><strong>{step.title}</strong><small>{step.duration} 分钟 · {statusLabel(step.status)}</small></span>
                    {hasMissingSafety(step) && <Icon icon="warning-sign" intent="danger" size={13} />}
                  </button>
                ))}
              </div>
              <div className="step-actions">
                <Button icon="arrow-up" small minimal disabled={steps[0]?.id === selectedStep.id} onClick={() => moveStep(-1)} />
                <Button icon="arrow-down" small minimal disabled={steps.at(-1)?.id === selectedStep.id} onClick={() => moveStep(1)} />
                <Button icon="duplicate" small minimal text="复制" onClick={duplicateStep} />
                <Button icon="trash" small minimal intent="danger" disabled={steps.length <= 1} onClick={deleteStep} />
              </div>
            </aside>

            <section className="editor-main">
              <Card elevation={Elevation.ONE} className="process-meta-card">
                <div className="card-title"><div><span>PROCESS INFO</span><h3>实验基本信息</h3></div><Tag minimal intent="primary">{steps.length} 个步骤</Tag></div>
                <div className="meta-grid">
                  <FormGroup label="实验名称" labelFor="process-title"><InputGroup id="process-title" fill value={workspace.title} onChange={(event) => updateWorkspaceField('title', event.target.value)} /></FormGroup>
                  <FormGroup label="流程编号" labelFor="process-code"><InputGroup id="process-code" fill value={workspace.code} onChange={(event) => updateWorkspaceField('code', event.target.value)} /></FormGroup>
                  <FormGroup label="负责人" labelFor="principal"><InputGroup id="principal" fill value={workspace.principal} onChange={(event) => updateWorkspaceField('principal', event.target.value)} /></FormGroup>
                  <FormGroup label="实验区域" labelFor="lab"><InputGroup id="lab" fill value={workspace.lab} onChange={(event) => updateWorkspaceField('lab', event.target.value)} /></FormGroup>
                </div>
                <FormGroup label="实验目标" labelFor="objective"><TextArea id="objective" fill value={workspace.objective} onChange={(event) => updateWorkspaceField('objective', event.target.value)} /></FormGroup>
              </Card>

              <Card elevation={Elevation.ONE} className="step-editor-card">
                <div className="card-title">
                  <div><span>STEP {String(steps.indexOf(selectedStep) + 1).padStart(2, '0')}</span><h3>{selectedStep.title}</h3></div>
                  <Tag minimal intent={selectedStep.status === 'confirmed' ? 'success' : selectedStep.status === 'returned' ? 'danger' : 'warning'}>{statusLabel(selectedStep.status)}</Tag>
                </div>
                <FormGroup label="步骤名称" labelFor="step-title"><InputGroup id="step-title" fill value={selectedStep.title} onChange={(event) => updateStep('title', event.target.value)} /></FormGroup>
                <FormGroup label="操作目的" labelFor="step-purpose"><TextArea id="step-purpose" fill value={selectedStep.purpose} onChange={(event) => updateStep('purpose', event.target.value)} /></FormGroup>
                <div className="form-grid">
                  <FormGroup label="材料" labelFor="materials"><TextArea id="materials" fill value={selectedStep.materials} onChange={(event) => updateStep('materials', event.target.value)} /></FormGroup>
                  <FormGroup label="设备" labelFor="equipment"><TextArea id="equipment" fill value={selectedStep.equipment} onChange={(event) => updateStep('equipment', event.target.value)} /></FormGroup>
                  <FormGroup label="用量 / 参数" labelFor="amount"><TextArea id="amount" fill value={selectedStep.amount} onChange={(event) => updateStep('amount', event.target.value)} /></FormGroup>
                  <FormGroup label="预计时间（分钟）" labelFor="duration"><InputGroup id="duration" type="number" min={1} fill value={String(selectedStep.duration)} onChange={(event) => updateStep('duration', Number(event.target.value))} /></FormGroup>
                </div>
                <div className="form-grid two-column">
                  <FormGroup label="危险项（逗号或换行分隔）" labelFor="hazards"><TextArea id="hazards" fill value={selectedStep.hazards.join('，')} onChange={(event) => updateStepList('hazards', event.target.value)} /></FormGroup>
                  <FormGroup label="控制措施" labelFor="controls"><TextArea id="controls" fill value={selectedStep.controls} onChange={(event) => updateStep('controls', event.target.value)} /></FormGroup>
                </div>
                <FormGroup label="安全说明" labelFor="safety-note" helperText={hasMissingSafety(selectedStep) ? '存在危险项时，控制措施和安全说明均为必填。' : '安全说明已满足复核条件。'}>
                  <TextArea id="safety-note" fill intent={hasMissingSafety(selectedStep) ? 'danger' : 'none'} value={selectedStep.safetyNote} onChange={(event) => updateStep('safetyNote', event.target.value)} />
                </FormGroup>
                <FormGroup label="预期结果" labelFor="expected"><TextArea id="expected" fill value={selectedStep.expectedResult} onChange={(event) => updateStep('expectedResult', event.target.value)} /></FormGroup>
              </Card>

              <Card elevation={Elevation.ONE} className="dependency-card">
                <div className="card-title"><div><span>DEPENDENCIES</span><h3>前置步骤</h3></div><Tag minimal>{selectedStep.dependencies.length} 个依赖</Tag></div>
                <p className="muted">当前步骤只有在所选前置步骤完成后才能进入执行队列。</p>
                <div className="dependency-grid">
                  {steps.filter((step) => step.id !== selectedStep.id).map((step) => (
                    <Checkbox key={step.id} checked={selectedStep.dependencies.includes(step.id)} label={`${String(steps.indexOf(step) + 1).padStart(2, '0')} · ${step.title}`} onChange={(event) => toggleDependency(step.id, event.currentTarget.checked)} />
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
                <div className="card-title"><div><span>RELEASE GATE</span><h3>提交与冻结</h3></div><Tag minimal>{draftProgressLabel(activeDraft)}</Tag></div>
                <div className="gate-row"><span>来源冻结版</span><strong>{activeSource?.version ?? '首版'}</strong></div>
                <div className="gate-row"><span>复核状态</span><strong>{confirmedCount}/{steps.length}</strong></div>
                <div className="gate-row"><span>安全缺口</span><strong className={missingSafetySteps.length ? 'danger-text' : ''}>{missingSafetySteps.length}</strong></div>
                <Divider />
                <Button fill intent="primary" icon="send-to" text="提交复核" onClick={submitForReview} />
                <Button fill intent="warning" icon="lock" text="全部确认后冻结为子版本" disabled={!canFreeze} onClick={openFreezeDialog} style={{ marginTop: 8 }} />
              </Card>
            </aside>
          </main>
        ) : (
          <main className="empty-workspace">
            <Card elevation={Elevation.ONE}>
              <Icon icon="git-branch" size={34} color="#2d72d2" />
              <h2>当前没有打开的修订稿</h2>
              <p>所有修订稿都已冻结。可到版本树中查看各冻结版本、比较差异，或从任一冻结版本（包括旧版本）建立新的修订稿。</p>
              <Button intent="primary" icon="diagram-tree" text="打开版本树" onClick={() => setActiveView('compare')} />
            </Card>
          </main>
        )
      )}

      {activeView === 'review' && (
        activeDraft && selectedStep ? (
          <main className="review-layout">
            <aside className="review-steps">
              <div className="panel-heading"><div><span>REVIEW QUEUE</span><h3>{activeDraft.label}</h3></div><Tag intent={pendingReviewCount ? 'warning' : 'success'}>{pendingReviewCount ? `${pendingReviewCount} 待处理` : '已完成'}</Tag></div>
              {steps.map((step, index) => (
                <button key={step.id} className={`${step.id === selectedStep.id ? 'selected' : ''} ${step.status}`} onClick={() => setSelectedStepId(step.id)}>
                  <span>{String(index + 1).padStart(2, '0')}</span><div><strong>{step.title}</strong><small>{statusLabel(step.status)}</small></div><Icon icon={step.status === 'confirmed' ? 'tick-circle' : step.status === 'returned' ? 'undo' : 'circle'} size={15} />
                </button>
              ))}
            </aside>
            <section className="review-main">
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
                  <TextArea fill value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="填写具体依据、风险或修改建议…" />
                  <Button intent="primary" icon="comment" text="添加批注" disabled={!commentText.trim()} onClick={addReviewComment} />
                </div>
                <div className="comment-list">
                  {selectedStep.comments.map((comment) => (
                    <article key={comment.id} className={comment.resolved ? 'resolved' : ''}>
                      <div className="comment-avatar">{comment.author.slice(0, 1)}</div>
                      <div><header><strong>{comment.author}</strong><span>{comment.role}</span><time>{formatDate(comment.createdAt)}</time></header><p>{comment.text}</p><Button minimal small text={comment.resolved ? '已解决' : '标记解决'} icon={comment.resolved ? 'tick' : 'circle'} onClick={() => resolveComment(comment.id)} /></div>
                    </article>
                  ))}
                  {!selectedStep.comments.length && <p className="muted">当前步骤尚未添加复核批注。</p>}
                </div>
              </Card>
            </section>
            <aside className="review-actions">
              <Card elevation={Elevation.ONE}>
                <div className="card-title"><div><span>REVIEWER ACTION</span><h3>复核决定</h3></div><Icon icon="endorsed" size={18} /></div>
                <p className="muted">确认后若修改该步骤，受影响的下游步骤会在编辑页重新提示。本修订稿冻结后将成为来源版本 {activeSource?.version ?? '首版'} 的子版本。</p>
                <Button fill large intent="success" icon="tick" text="逐条确认" disabled={hasMissingSafety(selectedStep)} onClick={() => setStepStatus('confirmed')} />
                <Button fill large icon="undo" text="退回修改" intent="warning" onClick={() => setStepStatus('returned')} />
                <Button fill large minimal icon="refresh" text="恢复为待复核" onClick={() => setStepStatus('submitted')} />
                <Divider />
                <div className="review-progress-list">
                  {steps.map((step) => <div key={step.id}><span>{step.title}</span><Tag minimal intent={step.status === 'confirmed' ? 'success' : step.status === 'returned' ? 'danger' : 'warning'}>{statusLabel(step.status)}</Tag></div>)}
                </div>
                <Button fill intent="primary" icon="lock" text="全部确认后冻结为子版本" onClick={openFreezeDialog} disabled={!canFreeze} />
              </Card>
            </aside>
          </main>
        ) : (
          <main className="empty-workspace">
            <Card elevation={Elevation.ONE}>
              <Icon icon="git-branch" size={34} color="#2d72d2" />
              <h2>没有可复核的修订稿</h2>
              <p>请先在版本树中从某个冻结版本建立修订稿。</p>
              <Button intent="primary" icon="diagram-tree" text="打开版本树" onClick={() => setActiveView('compare')} />
            </Card>
          </main>
        )
      )}

      {activeView === 'compare' && (
        <main className="compare-layout">
          <Card elevation={Elevation.ONE} className="version-panel">
            <div className="card-title">
              <div><span>VERSION TREE</span><h3>版本树（按父子关系）</h3></div>
              <Tag minimal>{workspace.versions.length} 冻结 · {workspace.drafts.length} 修订</Tag>
            </div>
            <p className="muted tree-hint">每个冻结版本都可单独建立修订稿；同一来源仅保留一份未冻结修订。冻结后修订稿成为来源版本的子版本。</p>
            <div className="version-tree">
              {versionTree.roots.map((node) => (
                <VersionTreeNode
                  key={node.version.id}
                  node={node}
                  depth={0}
                  draftsBySource={versionTree.draftsBySource}
                  activeDraftId={activeDraft?.id ?? ''}
                  compareBaseId={compareBaseId}
                  compareTargetId={compareTargetId}
                  onCreateRevision={createRevision}
                  onSwitchDraft={switchDraft}
                  onView={setViewSnapshotId}
                />
              ))}
              {versionTree.orphanDrafts.map((draft) => {
                const entry = snapshotEntries.find((item) => item.id === draft.id);
                return (
                  <div className="tree-draft orphan" key={draft.id}>
                    <span className="draft-dot"></span>
                    <div className="draft-copy">
                      <b>{draftVersionTag(undefined)}</b>
                      <strong>{draft.label}</strong>
                      <small>主干修订稿 · {draftProgressLabel(draft)}</small>
                    </div>
                    <div className="draft-actions">
                      {entry && <Button minimal small icon="eye-open" onClick={() => setViewSnapshotId(entry.id)} />}
                      <Button minimal small icon={draft.id === activeDraft?.id ? 'tick' : 'edit'} intent={draft.id === activeDraft?.id ? 'success' : 'none'} text={draft.id === activeDraft?.id ? '编辑中' : '继续修订'} onClick={() => switchDraft(draft.id)} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card elevation={Elevation.ONE} className="diff-panel">
            <div className="card-title"><div><span>VERSION DIFF</span><h3>分支查看与差异比较</h3></div><div className="diff-selects">
              <HTMLSelect value={compareBaseId} onChange={(event) => setCompareBaseId(event.target.value)}>{snapshotEntries.map((entry) => <option key={entry.id} value={entry.id}>{snapshotLabel(entry)} · 基准</option>)}</HTMLSelect>
              <Icon icon="arrow-right" />
              <HTMLSelect value={compareTargetId} onChange={(event) => setCompareTargetId(event.target.value)}>{snapshotEntries.map((entry) => <option key={entry.id} value={entry.id}>{snapshotLabel(entry)} · 目标</option>)}</HTMLSelect>
            </div></div>
            <div className="diff-table">
              <div className="diff-head"><span>变更类型</span><span>步骤</span><span>具体内容</span></div>
              {snapshotDiff.map((diff) => <div className={`diff-row ${diff.kind}`} key={diff.id}><Tag minimal intent={diff.kind === 'added' ? 'success' : diff.kind === 'removed' ? 'danger' : 'primary'}>{diff.kind === 'added' ? '新增' : diff.kind === 'removed' ? '删除' : '修改'}</Tag><strong>{diff.title}</strong><p>{diff.detail}</p></div>)}
              {!snapshotDiff.length && <div className="empty-diff"><Icon icon="comparison" size={30} /><strong>两个快照没有差异</strong><p>请选择不同的冻结版本或修订稿，或继续修订当前分支。</p></div>}
            </div>
          </Card>

          <Card elevation={Elevation.ONE} className="freeze-rules">
            <div className="card-title"><div><span>FREEZE RULES</span><h3>{activeDraft ? `冻结检查 · ${activeDraft.label}` : '冻结检查'}</h3></div></div>
            {activeDraft ? (
              <>
                <div className={confirmedCount === steps.length && steps.length > 0 ? 'passed' : ''}><Icon icon={confirmedCount === steps.length && steps.length > 0 ? 'tick-circle' : 'circle'} /><span><strong>所有步骤已确认</strong><small>{confirmedCount}/{steps.length}</small></span></div>
                <div className={!missingSafetySteps.length ? 'passed' : ''}><Icon icon={!missingSafetySteps.length ? 'tick-circle' : 'circle'} /><span><strong>安全信息完整</strong><small>{missingSafetySteps.length} 个缺口</small></span></div>
                <div className={steps.every((step) => step.dependencies.every((id) => steps.some((item) => item.id === id))) ? 'passed' : ''}><Icon icon="git-merge" /><span><strong>依赖引用有效</strong><small>{steps.reduce((sum, step) => sum + step.dependencies.length, 0)} 条依赖</small></span></div>
                <div className="passed"><Icon icon="diagram-tree" /><span><strong>冻结后挂到来源版本</strong><small>父版本 {activeSource?.version ?? '首版'} → 子版本 {freezeCandidateNumber}</small></span></div>
                <Button fill intent="primary" icon="lock" text={`冻结为子版本 ${freezeCandidateNumber}`} onClick={openFreezeDialog} disabled={!canFreeze} />
              </>
            ) : (
              <p className="muted">当前没有打开的修订稿。在左侧版本树中选择修订稿「继续修订」，或从任意冻结版本建立新修订稿后再冻结。</p>
            )}
          </Card>
        </main>
      )}

      <Dialog isOpen={freezeOpen} onClose={closeFreezeDialog} title="冻结修订稿为来源版本的子版本" icon="lock" className="freeze-dialog">
        <DialogBody>
          {activeDraft && (
            <>
              <div className="freeze-meta">
                <div><span>来源版本</span><strong>{activeSource?.version ?? '首版'} · {activeSource?.label ?? '首版批准流程'}</strong></div>
                <div><span>子版本号</span><strong>{freezeCandidateNumber}</strong></div>
                <div><span>修订稿</span><strong>{activeDraft.label}</strong></div>
              </div>
              <Callout intent="primary" icon="info-sign" className="freeze-callout">
                冻结后该修订稿从工作区移除，作为只读子版本挂到来源版本下；其他分支与修订稿不受影响。
              </Callout>
              <FormGroup label="本次改动摘要（必填）" labelFor="freeze-note" helperText="将记录在版本树节点上，用于说明本子版本相对来源版本的修订内容。">
                <TextArea id="freeze-note" fill value={freezeNote} onChange={(event) => setFreezeNote(event.target.value)} placeholder="例如：补充催化剂称量防护，调整取样频次为 6 点…" />
              </FormGroup>
              {suggestedSummary && (
                <Button minimal small icon="lightbulb" text={`填入自动摘要：${suggestedSummary}`} onClick={() => setFreezeNote(suggestedSummary)} />
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button text="取消" onClick={closeFreezeDialog} />
              <Button intent="primary" icon="lock" text="确认冻结" disabled={!freezeNote.trim()} onClick={confirmFreeze} />
            </>
          }
        />
      </Dialog>

      <Dialog isOpen={!!viewSnapshot} onClose={() => setViewSnapshotId(null)} title={viewSnapshot ? `${snapshotLabel(viewSnapshot)} · ${viewSnapshot.label}` : ''} icon="manual" className="view-dialog">
        <DialogBody>
          {viewSnapshot && (
            <div className="view-snapshot">
              <p className="muted">{formatDate(viewSnapshot.createdAt)} · {viewSnapshot.steps.length} 个步骤 · {snapshotSourceLabel(workspace, viewSnapshot)}</p>
              {viewSnapshot.kind === 'version' && (
                <Callout intent="none" icon="annotation" className="freeze-callout">
                  改动摘要：{workspace.versions.find((v) => v.id === viewSnapshot.id)?.changeSummary}
                </Callout>
              )}
              <div className="view-step-list">
                {viewSnapshot.steps.map((step, index) => (
                  <article key={step.id}>
                    <header><span>{String(index + 1).padStart(2, '0')}</span><strong>{step.title}</strong><Tag minimal intent={step.status === 'confirmed' ? 'success' : step.status === 'returned' ? 'danger' : 'warning'}>{statusLabel(step.status)}</Tag></header>
                    <p>{step.purpose || '未填写操作目的'}</p>
                    <small>{step.materials || '无材料'} · {step.amount || '无用量'} · {step.duration} 分钟 · 危险项：{step.hazards.join('、') || '无'}</small>
                  </article>
                ))}
              </div>
            </div>
          )}
        </DialogBody>
        <DialogFooter actions={<Button intent="primary" text="关闭" onClick={() => setViewSnapshotId(null)} />} />
      </Dialog>

      <footer className="app-footer">
        <span>版本树、修订分支与改动摘要均保存在当前浏览器 localStorage，重新打开不丢失父子关系。</span>
        <span>Ctrl/Cmd + Z 撤销 · Ctrl/Cmd + Y 重做 · Ctrl/Cmd + S 保存</span>
      </footer>
    </div>
  );
}

interface VersionTreeNodeData {
  version: VersionSnapshot;
  children: VersionTreeNodeData[];
}

interface VersionTreeData {
  roots: VersionTreeNodeData[];
  draftsBySource: Map<string, DraftRevision[]>;
  orphanDrafts: DraftRevision[];
}

function buildVersionTree(workspace: ExperimentWorkspace): VersionTreeData {
  const nodeMap = new Map<string, VersionTreeNodeData>();
  workspace.versions.forEach((version) => nodeMap.set(version.id, { version, children: [] }));
  const roots: VersionTreeNodeData[] = [];
  workspace.versions.forEach((version) => {
    const node = nodeMap.get(version.id)!;
    const parent = version.parentId ? nodeMap.get(version.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  // 按冻结时间稳定排序
  const sortRecursive = (nodes: VersionTreeNodeData[]) => {
    nodes.sort((a, b) => a.version.createdAt.localeCompare(b.version.createdAt));
    nodes.forEach((node) => sortRecursive(node.children));
  };
  sortRecursive(roots);
  const draftsBySource = new Map<string, DraftRevision[]>();
  workspace.drafts.forEach((draft) => {
    const list = draftsBySource.get(draft.sourceVersionId) ?? [];
    list.push(draft);
    draftsBySource.set(draft.sourceVersionId, list);
  });
  const knownSources = new Set(workspace.versions.map((version) => version.id));
  const orphanDrafts = workspace.drafts.filter((draft) => !knownSources.has(draft.sourceVersionId));
  return { roots, draftsBySource, orphanDrafts };
}

interface VersionTreeNodeProps {
  node: VersionTreeNodeData;
  depth: number;
  draftsBySource: Map<string, DraftRevision[]>;
  activeDraftId: string;
  compareBaseId: string;
  compareTargetId: string;
  onCreateRevision: (sourceVersionId: string) => void;
  onSwitchDraft: (draftId: string) => void;
  onView: (snapshotId: string) => void;
}

function VersionTreeNode(props: VersionTreeNodeProps) {
  const {
    node, depth, draftsBySource, activeDraftId, compareBaseId, compareTargetId,
    onCreateRevision, onSwitchDraft, onView
  } = props;
  const { version } = node;
  const drafts = draftsBySource.get(version.id) ?? [];
  const isBase = compareBaseId === version.id;
  const isTarget = compareTargetId === version.id;

  return (
    <div className="tree-node">
      <div className={`tree-node-row${isBase || isTarget ? ' in-compare' : ''}`}>
        <span className="tree-dot"><Icon icon="lock" size={10} /></span>
        <div className="tree-copy">
          <div className="tree-copy-head">
            <b>{version.version}</b>
            <strong>{version.label}</strong>
            {isBase && <Tag minimal intent="primary">比较基准</Tag>}
            {isTarget && <Tag minimal intent="success">比较目标</Tag>}
            {depth === 0 && <Tag minimal>根版本</Tag>}
            {depth > 0 && <Tag minimal intent="warning">子版本</Tag>}
          </div>
          <p>{formatDate(version.createdAt)} · {version.steps.length} 个步骤 · {version.author}</p>
          <small className="tree-summary">改动摘要：{version.changeSummary}</small>
        </div>
        <div className="tree-actions">
          <Button minimal small icon="eye-open" title="查看该版本" onClick={() => onView(version.id)} />
          {drafts.length === 0
            ? <Button minimal small icon="git-branch" text="建立修订" onClick={() => onCreateRevision(version.id)} />
            : <Tag minimal intent="warning" icon="git-branch">已有 1 份未冻结修订</Tag>}
        </div>
      </div>

      <div className="tree-children">
        {node.children.map((child) => (
          <VersionTreeNode key={child.version.id} {...props} node={child} depth={depth + 1} />
        ))}
        {drafts.map((draft) => (
          <div className={`tree-draft${draft.id === activeDraftId ? ' active' : ''}`} key={draft.id}>
            <span className="draft-dot"></span>
            <div className="draft-copy">
              <div className="tree-copy-head">
                <b>{draftVersionTag(version)}</b>
                <strong>{draft.label}</strong>
                {draft.id === activeDraftId && <Tag minimal intent="success">编辑中</Tag>}
              </div>
              <small>未冻结修订稿 · {draftProgressLabel(draft)} · 更新于 {formatDate(draft.updatedAt)}</small>
            </div>
            <div className="draft-actions">
              <Button minimal small icon="eye-open" title="查看修订稿" onClick={() => onView(draft.id)} />
              <Button
                minimal small
                icon={draft.id === activeDraftId ? 'edit' : 'swap-horizontal'}
                intent={draft.id === activeDraftId ? 'success' : 'none'}
                text={draft.id === activeDraftId ? '继续修订' : '切换修订'}
                onClick={() => onSwitchDraft(draft.id)}
              />
            </div>
          </div>
        ))}
      </div>
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

function compareStepLists(baseSteps: ProcessStep[], targetSteps: ProcessStep[]): DiffItem[] {
  const diffs: DiffItem[] = [];
  const targetMap = new Map(targetSteps.map((step) => [step.id, step]));
  const baseMap = new Map(baseSteps.map((step) => [step.id, step]));
  baseSteps.forEach((step) => {
    if (!targetMap.has(step.id)) diffs.push({ id: step.id, title: step.title, kind: 'removed', detail: '目标快照已删除该步骤。', fields: [] });
  });
  targetSteps.forEach((step) => {
    const before = baseMap.get(step.id);
    if (!before) {
      diffs.push({ id: step.id, title: step.title, kind: 'added', detail: `${step.duration} 分钟；危险项：${step.hazards.join('、') || '无'}`, fields: [] });
      return;
    }
    const fields: string[] = [];
    if (before.title !== step.title) fields.push('名称');
    if (before.purpose !== step.purpose) fields.push('目的');
    if (before.materials !== step.materials || before.amount !== step.amount) fields.push('材料或用量');
    if (before.equipment !== step.equipment) fields.push('设备');
    if (before.duration !== step.duration) fields.push('预计时间');
    if (JSON.stringify(before.hazards) !== JSON.stringify(step.hazards)) fields.push('危险项');
    if (before.controls !== step.controls || before.safetyNote !== step.safetyNote) fields.push('安全控制');
    if (JSON.stringify(before.dependencies) !== JSON.stringify(step.dependencies)) fields.push('依赖关系');
    if (before.expectedResult !== step.expectedResult) fields.push('预期结果');
    if (fields.length) diffs.push({ id: step.id, title: step.title, kind: 'changed', detail: `变化字段：${fields.join('、')}。`, fields });
  });
  return diffs;
}

function compareSnapshotSteps(entries: SnapshotEntry[], baseId: string, targetId: string): DiffItem[] {
  const base = entries.find((entry) => entry.id === baseId);
  const target = entries.find((entry) => entry.id === targetId);
  if (!base || !target || base.id === target.id) return [];
  return compareStepLists(base.steps, target.steps);
}

/** 根据差异生成冻结时建议的改动摘要。 */
function summarizeDiff(diffs: DiffItem[]): string {
  if (!diffs.length) return '';
  const added = diffs.filter((diff) => diff.kind === 'added').length;
  const removed = diffs.filter((diff) => diff.kind === 'removed').length;
  const changed = diffs.filter((diff) => diff.kind === 'changed');
  const parts: string[] = [];
  if (added) parts.push(`新增 ${added} 个步骤`);
  if (removed) parts.push(`删除 ${removed} 个步骤`);
  if (changed.length) {
    const fieldSet = new Set<string>();
    changed.forEach((diff) => diff.fields.forEach((field) => fieldSet.add(field)));
    parts.push(`修订 ${changed.length} 个步骤（${[...fieldSet].slice(0, 4).join('、')}）`);
  }
  return parts.join('；');
}

export default App;
