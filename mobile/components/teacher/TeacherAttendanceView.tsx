import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
  BackHandler,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { apiFetch } from '@/services/api';
import {
  mobileAttendanceDriveSync,
  deriveDriveBackupUiModel,
  sanitizeClientErrorMessage,
} from '@/services/attendance-drive-sync';
import { resolveAppRole } from '@/utils/roles';

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface AttendanceCohortItem {
  id: string;
  slotCode: string;
  displayName: string;
  currentSemester: number;
  intakeYear?: number | null;
  intakeIdentifier?: string | null;
  status: string;
}

export interface AttendanceSubjectItem {
  id: string;
  code: string;
  name: string;
  title?: string;
  semester: number;
  department?: string;
  creditHours?: number;
  nature?: string | null;
  cohorts?: AttendanceCohortItem[];
  hasMultipleActiveCohorts?: boolean;
}

export interface TeacherAttendanceContextResponse {
  role: string;
  userId: string;
  name: string;
  currentNepalDate: string;
  assignedSemesters: number[];
  subjects: AttendanceSubjectItem[];
  cohorts: AttendanceCohortItem[];
}

export interface RosterStudentItem {
  studentId: string;
  username?: string | null;
  name: string;
  email?: string | null;
  role: string;
  department?: string;
  semester?: string | null;
  cohortId: string;
  avatarUrl?: string | null;
  status: 'present' | 'absent' | null;
}

export interface AttendanceSessionInfo {
  id: string;
  subjectId: string;
  subjectCode?: string | null;
  subjectName?: string | null;
  cohortId: string;
  cohortName?: string | null;
  slotCode?: string | null;
  semesterNo: number;
  teacherId: string;
  recordedByUserId: string;
  sessionDate: string;
  status: 'draft' | 'submitted' | 'locked';
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
  editWindow?: {
    submittedAt: string;
    editWindowEndsAt: string;
    editWindowHours: number;
    isWithinEditWindow: boolean;
    canTeacherEdit: boolean;
    requiresAdminCorrection: boolean;
    remainingMs: number;
  } | null;
  counts?: {
    total: number;
    present: number;
    absent: number;
    attendancePercentage: number;
  };
}

export interface AttendanceRosterResponse {
  subject: {
    id: string;
    code: string;
    name: string;
    semester: number;
    department: string;
  };
  cohort: AttendanceCohortItem;
  sessionDate: string;
  roster: RosterStudentItem[];
  rosterCount: number;
  session: AttendanceSessionInfo | null;
  records: {
    id: string;
    sessionId: string;
    studentId: string;
    status: 'present' | 'absent';
    markedBy: string;
    createdAt: string;
    updatedAt: string;
  }[];
}

export interface AuditLogItem {
  id: string;
  sessionId: string;
  action: string;
  actorUserId: string;
  actorName?: string;
  actorRole: string;
  reason?: string | null;
  createdAt: string;
}

type AttendanceStage = 'marking' | 'review' | 'history';

function computeLiveEditWindow(session: AttendanceSessionInfo | null | undefined, nowMs: number) {
  if (!session || !session.submittedAt) {
    return {
      hasSubmittedAt: false,
      canEdit: false,
      remainingMs: 0,
      label: 'Edit window unavailable',
    };
  }
  const submittedMs = new Date(session.submittedAt).getTime();
  if (!Number.isFinite(submittedMs)) {
    return {
      hasSubmittedAt: false,
      canEdit: false,
      remainingMs: 0,
      label: 'Edit window unavailable',
    };
  }
  const expiresAtMs = submittedMs + EDIT_WINDOW_MS;
  const remainingMs = expiresAtMs - nowMs;
  const canEdit = session.status !== 'locked' && remainingMs > 0;

  if (!canEdit) {
    return {
      hasSubmittedAt: true,
      canEdit: false,
      remainingMs: 0,
      label: '24h edit window expired (Read-Only)',
    };
  }

  const totalSec = Math.max(0, Math.floor(remainingMs / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  return {
    hasSubmittedAt: true,
    canEdit: true,
    remainingMs,
    label: `Editable for ${pad(hrs)}h ${pad(mins)}m ${pad(secs)}s`,
  };
}

function stepNepalDate(yyyyMmDd: string, deltaDays: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return yyyyMmDd;
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface TeacherAttendanceViewProps {
  initialSubjectId?: string;
  initialCohortId?: string;
  initialDate?: string;
  onClose?: () => void;
}

export function TeacherAttendanceView({
  initialSubjectId,
  initialCohortId,
  initialDate,
  onClose,
}: TeacherAttendanceViewProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const appRole = resolveAppRole(user);
  const isAuthorizedStaff = appRole === 'teacher' || appRole === 'admin';

  // Selection state (preserved across Marking, Review, and History stages)
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(initialSubjectId || '');
  const [selectedCohortId, setSelectedCohortId] = useState<string>(initialCohortId || '');
  const [selectedDate, setSelectedDate] = useState<string>(initialDate || '');
  const [customDateModalOpen, setCustomDateModalOpen] = useState(false);
  const [customDateInput, setCustomDateInput] = useState('');

  // Workflow stage & marking state
  const [stage, setStage] = useState<AttendanceStage>('marking');
  const [currentStudentIndex, setCurrentStudentIndex] = useState<number>(0);
  const [marksByStudentId, setMarksByStudentId] = useState<Record<string, 'present' | 'absent'>>({});
  const [initialMarksSnapshot, setInitialMarksSnapshot] = useState<string>('{}');

  // Submission & feedback state
  const [isSaving, setIsSaving] = useState(false);
  const isSubmittingRef = useRef(false);
  const didApplyInitialSubjectRef = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);

  // Audit modal state
  const [auditModalSessionId, setAuditModalSessionId] = useState<string | null>(null);

  // Phase 3C — Mobile Teacher Google Drive Attendance Backup state
  const [backupStatusData, setBackupStatusData] = useState<any | null>(null);
  const [backupPendingRuns, setBackupPendingRuns] = useState<any[]>([]);
  const [isLoadingBackupStatus, setIsLoadingBackupStatus] = useState<boolean>(false);
  const [isBackupConnecting, setIsBackupConnecting] = useState<boolean>(false);
  const [isBackupSyncing, setIsBackupSyncing] = useState<boolean>(false);
  const [isBackupDisconnecting, setIsBackupDisconnecting] = useState<boolean>(false);
  const [backupNoticeMessage, setBackupNoticeMessage] = useState<string | null>(null);
  const [backupErrorMessage, setBackupErrorMessage] = useState<string | null>(null);
  const [backupReconnectRequired, setBackupReconnectRequired] = useState<boolean>(false);

  const isMountedRef = useRef<boolean>(true);
  const isBackupActionInFlightRef = useRef<boolean>(false);
  const backupStatusReqIdRef = useRef<number>(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Live 1-second ticker for 24h edit countdowns
  const [nowTick, setNowTick] = useState<number>(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const refreshDriveBackupState = useCallback(
    async ({ preserveMessages = false }: { preserveMessages?: boolean } = {}) => {
      if (!isAuthorizedStaff || !user?.studentId) return;
      const reqId = ++backupStatusReqIdRef.current;
      if (isMountedRef.current) {
        setIsLoadingBackupStatus(true);
        if (!preserveMessages) {
          setBackupErrorMessage(null);
        }
      }

      try {
        const [statusRes, pendingRes] = await Promise.all([
          mobileAttendanceDriveSync.getStatus().catch(() => null),
          mobileAttendanceDriveSync.listPendingWork().catch(() => ({ pendingCount: 0, runs: [] })),
        ]);

        if (!isMountedRef.current || reqId !== backupStatusReqIdRef.current) return;

        if (statusRes) {
          setBackupStatusData(statusRes);
          const connStatus = statusRes.connection?.connectionStatus;
          const reconnectRuns = Number(statusRes.summary?.reconnectRequiredRuns || 0);
          if (connStatus === 'reconnect_required' || reconnectRuns > 0) {
            setBackupReconnectRequired(true);
          } else if (
            connStatus === 'connected' ||
            connStatus === 'disconnected' ||
            connStatus === 'not_configured'
          ) {
            setBackupReconnectRequired(false);
          }
        }

        if (pendingRes && Array.isArray(pendingRes.runs)) {
          setBackupPendingRuns(pendingRes.runs);
        }
      } catch {
        // Non-blocking background status check: never disrupt classroom attendance
      } finally {
        if (isMountedRef.current && reqId === backupStatusReqIdRef.current) {
          setIsLoadingBackupStatus(false);
        }
      }
    },
    [isAuthorizedStaff, user?.studentId]
  );

  useEffect(() => {
    if (isAuthorizedStaff && user?.studentId) {
      refreshDriveBackupState();
    }
  }, [isAuthorizedStaff, user?.studentId, refreshDriveBackupState]);

  const handleConnectDriveBackup = useCallback(async () => {
    if (
      isBackupActionInFlightRef.current ||
      isBackupConnecting ||
      isBackupSyncing ||
      isBackupDisconnecting
    ) {
      return;
    }

    isBackupActionInFlightRef.current = true;
    if (isMountedRef.current) {
      setIsBackupConnecting(true);
      setBackupErrorMessage(null);
      setBackupNoticeMessage(null);
    }

    try {
      const res: any = await mobileAttendanceDriveSync.connectGoogleDrive();
      if (!isMountedRef.current) return;

      if (res?.notConfigured || res?.status === 'not_configured') {
        setIsBackupConnecting(false);
        await refreshDriveBackupState({ preserveMessages: true });
        return;
      }

      setIsBackupConnecting(false);
      setBackupReconnectRequired(false);
      setBackupNoticeMessage('Google Drive connected and backup folders verified.');
      await refreshDriveBackupState({ preserveMessages: true });
    } catch (err: any) {
      if (!isMountedRef.current) return;
      setIsBackupConnecting(false);
      const errCode = String(err?.code || '');
      if (errCode === 'OAUTH_CANCELLED') {
        setBackupErrorMessage('Google Drive sign-in was cancelled before completion.');
      } else if (errCode === 'OAUTH_SCOPE_MISSING') {
        setBackupErrorMessage(
          'Google Drive file permission (drive.file) was not granted. Please reconnect and approve file access.'
        );
      } else {
        setBackupErrorMessage(sanitizeClientErrorMessage(err?.message));
      }
      await refreshDriveBackupState({ preserveMessages: true });
    } finally {
      isBackupActionInFlightRef.current = false;
    }
  }, [
    isBackupConnecting,
    isBackupSyncing,
    isBackupDisconnecting,
    refreshDriveBackupState,
  ]);

  const handleSyncDriveBackup = useCallback(
    async ({ forceRetry = true }: { forceRetry?: boolean } = {}) => {
      if (
        isBackupActionInFlightRef.current ||
        isBackupConnecting ||
        isBackupSyncing ||
        isBackupDisconnecting
      ) {
        return;
      }

      isBackupActionInFlightRef.current = true;
      if (isMountedRef.current) {
        setIsBackupSyncing(true);
        setBackupErrorMessage(null);
        setBackupNoticeMessage(null);
      }

      try {
        const syncResult: any = await mobileAttendanceDriveSync.syncPendingWork({
          forceRetry: Boolean(forceRetry),
        });
        if (!isMountedRef.current) return;
        setIsBackupSyncing(false);

        if (syncResult?.notConfigured || syncResult?.status === 'not_configured') {
          await refreshDriveBackupState({ preserveMessages: true });
          return;
        }

        if (syncResult?.reconnectRequired || syncResult?.status === 'reconnect_required') {
          setBackupReconnectRequired(true);
          setBackupErrorMessage(
            syncResult?.errorMessage
              ? sanitizeClientErrorMessage(syncResult.errorMessage)
              : 'Google Drive authorization has expired or requires reconnection. Tap Reconnect Google Drive to sync pending backups.'
          );
          await refreshDriveBackupState({ preserveMessages: true });
          return;
        }

        const completedCount = Number(syncResult?.completedArtifacts || 0);
        const failedCount = Number(syncResult?.failedArtifacts || 0);
        const processedRuns = Number(syncResult?.processedRuns || 0);

        if (failedCount > 0 && completedCount > 0) {
          setBackupErrorMessage(
            `Partial backup sync: ${completedCount} artifact${
              completedCount === 1 ? '' : 's'
            } backed up, ${failedCount} failed. Completed files are preserved; tap Retry Sync to retry remaining items.`
          );
        } else if (failedCount > 0) {
          const firstErr =
            syncResult?.errorMessage ||
            (Array.isArray(syncResult?.runs) &&
              syncResult.runs
                .flatMap((r: any) => r.artifacts || [])
                .find((a: any) => a.errorMessage)?.errorMessage) ||
            'One or more backup artifacts failed to upload.';
          setBackupErrorMessage(
            `Backup sync failed (${failedCount} artifact${
              failedCount === 1 ? '' : 's'
            }): ${sanitizeClientErrorMessage(firstErr)}`
          );
        } else if (processedRuns === 0 || completedCount === 0) {
          setBackupNoticeMessage(
            'Everything is up to date. All attendance revisions are backed up to Google Drive.'
          );
        } else {
          setBackupNoticeMessage(
            `Google Drive backup complete: ${completedCount} artifact${
              completedCount === 1 ? '' : 's'
            } synced across ${processedRuns} revision${processedRuns === 1 ? '' : 's'}.`
          );
        }

        await refreshDriveBackupState({ preserveMessages: true });
      } catch (err: any) {
        if (!isMountedRef.current) return;
        setIsBackupSyncing(false);
        if (err?.reconnectRequired) {
          setBackupReconnectRequired(true);
        }
        setBackupErrorMessage(sanitizeClientErrorMessage(err?.message));
        await refreshDriveBackupState({ preserveMessages: true });
      } finally {
        isBackupActionInFlightRef.current = false;
      }
    },
    [
      isBackupConnecting,
      isBackupSyncing,
      isBackupDisconnecting,
      refreshDriveBackupState,
    ]
  );

  const executeDisconnectDriveBackup = useCallback(async () => {
    if (
      isBackupActionInFlightRef.current ||
      isBackupConnecting ||
      isBackupSyncing ||
      isBackupDisconnecting
    ) {
      return;
    }

    isBackupActionInFlightRef.current = true;
    if (isMountedRef.current) {
      setIsBackupDisconnecting(true);
      setBackupErrorMessage(null);
      setBackupNoticeMessage(null);
    }

    try {
      const discRes: any = await mobileAttendanceDriveSync.disconnectGoogleDrive({
        clearFolders: false,
      });
      if (!discRes || !discRes.disconnected) {
        throw new Error('Server did not confirm Google Drive disconnection.');
      }
      if (!isMountedRef.current) return;
      setIsBackupDisconnecting(false);
      setBackupReconnectRequired(false);
      setBackupNoticeMessage(
        'Google Drive has been disconnected. Attendance records and completed backups remain intact.'
      );
      await refreshDriveBackupState({ preserveMessages: true });
    } catch (err: any) {
      if (!isMountedRef.current) return;
      setIsBackupDisconnecting(false);
      setBackupErrorMessage(`Disconnect failed: ${sanitizeClientErrorMessage(err?.message)}`);
      await refreshDriveBackupState({ preserveMessages: true });
    } finally {
      isBackupActionInFlightRef.current = false;
    }
  }, [
    isBackupConnecting,
    isBackupSyncing,
    isBackupDisconnecting,
    refreshDriveBackupState,
  ]);

  const handleDisconnectDriveBackup = useCallback(() => {
    if (
      isBackupActionInFlightRef.current ||
      isBackupConnecting ||
      isBackupSyncing ||
      isBackupDisconnecting
    ) {
      return;
    }
    Alert.alert(
      'Disconnect Google Drive?',
      'Disconnect your Google Drive account from Attendance Backup? Existing attendance records and files already backed up in your Google Drive will not be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            executeDisconnectDriveBackup();
          },
        },
      ]
    );
  }, [
    isBackupConnecting,
    isBackupSyncing,
    isBackupDisconnecting,
    executeDisconnectDriveBackup,
  ]);

  const backupUiModel = useMemo(
    () =>
      deriveDriveBackupUiModel({
        statusData: backupStatusData,
        pendingRuns: backupPendingRuns,
        isLoadingStatus: isLoadingBackupStatus,
        isConnecting: isBackupConnecting,
        isSyncing: isBackupSyncing,
        isDisconnecting: isBackupDisconnecting,
        noticeMessage: backupNoticeMessage,
        errorMessage: backupErrorMessage,
        reconnectRequiredFlag: backupReconnectRequired,
      }),
    [
      backupStatusData,
      backupPendingRuns,
      isLoadingBackupStatus,
      isBackupConnecting,
      isBackupSyncing,
      isBackupDisconnecting,
      backupNoticeMessage,
      backupErrorMessage,
      backupReconnectRequired,
    ]
  );

  const hasUnsavedChanges = useMemo(() => {
    return JSON.stringify(marksByStudentId) !== initialMarksSnapshot;
  }, [marksByStudentId, initialMarksSnapshot]);

  const confirmNavigationWithUnsavedGuard = useCallback(
    (onConfirm: () => void) => {
      if (!hasUnsavedChanges) {
        onConfirm();
        return;
      }
      Alert.alert(
        'Discard Unsaved Attendance?',
        'You have unsaved attendance selections for this session. Leaving now will discard your changes.',
        [
          { text: 'Keep Marking', style: 'cancel' },
          {
            text: 'Discard Changes',
            style: 'destructive',
            onPress: onConfirm,
          },
        ]
      );
    },
    [hasUnsavedChanges]
  );

  // Hardware back button guard on Android when unsaved changes exist
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!hasUnsavedChanges) return false;
      confirmNavigationWithUnsavedGuard(() => {
        if (onClose) onClose();
        else router.back();
      });
      return true;
    });
    return () => sub.remove();
  }, [hasUnsavedChanges, confirmNavigationWithUnsavedGuard, onClose]);

  // 1. Fetch Teacher Attendance Context: GET /api/attendance/teacher/context
  const {
    data: contextData,
    isLoading: isContextLoading,
    error: contextError,
    refetch: refetchContext,
  } = useQuery<TeacherAttendanceContextResponse>({
    queryKey: ['attendance-teacher-context', user?.studentId],
    queryFn: async () => {
      const res = await apiFetch('/api/attendance/teacher/context');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.message || 'Failed to load teacher attendance context.');
      }
      return json;
    },
    enabled: Boolean(isAuthorizedStaff && user?.studentId),
    staleTime: 30 * 1000,
  });

  const currentNepalDate = contextData?.currentNepalDate || '';
  const subjects = useMemo(() => contextData?.subjects || [], [contextData?.subjects]);

  // Initialize default subject & Nepal date when context arrives
  useEffect(() => {
    if (!contextData) return;

    if (!selectedDate && contextData.currentNepalDate) {
      setSelectedDate(contextData.currentNepalDate);
    }

    if (subjects.length > 0) {
      if (initialSubjectId && !didApplyInitialSubjectRef.current) {
        didApplyInitialSubjectRef.current = true;
        const norm = initialSubjectId.trim().toLowerCase();
        const matched = subjects.find(
          (s) =>
            s.id.toLowerCase() === norm ||
            s.code.toLowerCase() === norm ||
            s.name.toLowerCase() === norm
        );
        if (matched) {
          setSelectedSubjectId(matched.id);
          return;
        }
      }
      const exists = subjects.some((s) => s.id === selectedSubjectId);
      if (!exists) {
        setSelectedSubjectId(subjects[0].id);
      }
    }
  }, [contextData, subjects, initialSubjectId, selectedSubjectId, selectedDate]);

  const selectedSubject = useMemo(
    () => subjects.find((s) => s.id === selectedSubjectId) || null,
    [subjects, selectedSubjectId]
  );

  const eligibleCohorts = useMemo(() => {
    if (!selectedSubject) return [];
    if (Array.isArray(selectedSubject.cohorts)) return selectedSubject.cohorts;
    return (contextData?.cohorts || []).filter(
      (c) => Number(c.currentSemester) === Number(selectedSubject.semester)
    );
  }, [selectedSubject, contextData?.cohorts]);

  // Keep selectedCohortId synchronized with eligible cohorts for the active subject
  useEffect(() => {
    if (eligibleCohorts.length === 0) {
      if (selectedCohortId !== '') setSelectedCohortId('');
      return;
    }
    const stillValid = eligibleCohorts.some((c) => c.id === selectedCohortId);
    if (!stillValid) {
      setSelectedCohortId(eligibleCohorts[0].id);
    }
  }, [eligibleCohorts, selectedCohortId]);

  // 2. Fetch Authorized Cohort Roster & Session: GET /api/attendance/roster
  const canLoadRoster = Boolean(
    isAuthorizedStaff && selectedSubjectId && selectedCohortId && selectedDate
  );

  const {
    data: rosterData,
    isLoading: isRosterLoading,
    error: rosterError,
    refetch: refetchRoster,
  } = useQuery<AttendanceRosterResponse>({
    queryKey: [
      'attendance-roster',
      user?.studentId,
      selectedSubjectId,
      selectedCohortId,
      selectedDate,
    ],
    queryFn: async () => {
      const qs = new URLSearchParams({
        subjectId: selectedSubjectId,
        cohortId: selectedCohortId,
        date: selectedDate,
      });
      const res = await apiFetch(`/api/attendance/roster?${qs.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.message || 'Failed to load class roster.');
      }
      return json;
    },
    enabled: canLoadRoster,
    staleTime: 10 * 1000,
  });

  // Synchronize local marking state whenever rosterData loads for a subject/cohort/date
  useEffect(() => {
    if (!rosterData) return;
    const initialMarks: Record<string, 'present' | 'absent'> = {};
    for (const student of rosterData.roster || []) {
      if (student.status === 'present' || student.status === 'absent') {
        initialMarks[student.studentId] = student.status;
      }
    }
    setMarksByStudentId(initialMarks);
    setInitialMarksSnapshot(JSON.stringify(initialMarks));
    setCurrentStudentIndex(0);

    const win = computeLiveEditWindow(rosterData.session, Date.now());
    if (rosterData.session && !win.canEdit) {
      setStage((prev) => (prev === 'marking' ? 'review' : prev));
    }
  }, [rosterData]);

  // 3. Fetch Historical Sessions: GET /api/attendance/sessions
  const {
    data: historyData,
    isLoading: isHistoryLoading,
    refetch: refetchHistory,
  } = useQuery<{ sessions: AttendanceSessionInfo[] }>({
    queryKey: ['attendance-sessions', user?.studentId, selectedSubjectId, selectedCohortId],
    queryFn: async () => {
      const qs = new URLSearchParams({ subjectId: selectedSubjectId });
      if (selectedCohortId) qs.set('cohortId', selectedCohortId);
      const res = await apiFetch(`/api/attendance/sessions?${qs.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.message || 'Failed to load attendance sessions.');
      }
      return json;
    },
    enabled: Boolean(isAuthorizedStaff && selectedSubjectId),
    staleTime: 15 * 1000,
  });

  // 4. Fetch Audit Logs when Audit Modal is open: GET /api/attendance/sessions/:id/audit
  const { data: auditData, isLoading: isAuditLoading } = useQuery<{
    sessionId: string;
    logs: AuditLogItem[];
  }>({
    queryKey: ['attendance-session-audit', auditModalSessionId],
    queryFn: async () => {
      const res = await apiFetch(
        `/api/attendance/sessions/${encodeURIComponent(auditModalSessionId!)}/audit`
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.message || 'Failed to load session audit history.');
      }
      return json;
    },
    enabled: Boolean(auditModalSessionId),
  });

  const roster = useMemo(() => {
    const raw = rosterData?.roster || [];
    return [...raw].sort((a, b) => {
      const nameA = String(a?.name || a?.studentId || '').trim();
      const nameB = String(b?.name || b?.studentId || '').trim();
      const cmp = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
      if (cmp !== 0) return cmp;
      return String(a?.studentId || '').localeCompare(String(b?.studentId || ''), undefined, {
        sensitivity: 'base',
      });
    });
  }, [rosterData?.roster]);
  const existingSession = rosterData?.session || null;
  const editWindowInfo = useMemo(
    () => computeLiveEditWindow(existingSession, nowTick),
    [existingSession, nowTick]
  );
  const isReadOnly = Boolean(existingSession && !editWindowInfo.canEdit);

  // Roster summary counts
  const counts = useMemo(() => {
    const total = roster.length;
    let present = 0;
    let absent = 0;
    let unmarked = 0;

    for (const s of roster) {
      const st = marksByStudentId[s.studentId];
      if (st === 'present') present += 1;
      else if (st === 'absent') absent += 1;
      else unmarked += 1;
    }

    return {
      total,
      marked: present + absent,
      present,
      absent,
      unmarked,
    };
  }, [roster, marksByStudentId]);

  const handleSelectStatus = (studentId: string, status: 'present' | 'absent', autoAdvance = true) => {
    if (isSaving || isSubmittingRef.current || isReadOnly) return;

    setMarksByStudentId((prev) => ({
      ...prev,
      [studentId]: status,
    }));
    setSaveError(null);
    setSaveSuccessMessage(null);

    if (autoAdvance && stage === 'marking' && roster.length > 0) {
      if (currentStudentIndex < roster.length - 1) {
        setCurrentStudentIndex((idx) => Math.min(roster.length - 1, idx + 1));
      }
    }
  };

  const handleSubmitAttendance = async () => {
    if (isSaving || isSubmittingRef.current) return;

    if (counts.total === 0) {
      setSaveError('Cannot submit attendance for an empty roster.');
      return;
    }

    if (counts.unmarked > 0) {
      setSaveError(
        `Please mark all students before submitting (${counts.unmarked} student${
          counts.unmarked === 1 ? '' : 's'
        } unmarked).`
      );
      return;
    }

    if (isReadOnly) {
      setSaveError(
        'The 24-hour teacher editing window has expired. An administrator must authorize corrections.'
      );
      return;
    }

    isSubmittingRef.current = true;
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccessMessage(null);

    const recordsPayload = roster.map((student) => ({
      studentId: student.studentId,
      status: marksByStudentId[student.studentId],
    }));

    try {
      const isEditingExisting = Boolean(existingSession?.id);
      const endpoint = isEditingExisting
        ? `/api/attendance/sessions/${encodeURIComponent(existingSession!.id)}`
        : '/api/attendance/sessions';
      const method = isEditingExisting ? 'PUT' : 'POST';

      const payload = isEditingExisting
        ? {
            records: recordsPayload,
            reason: 'Updated by teacher within 24-hour window',
          }
        : {
            subjectId: selectedSubjectId,
            cohortId: selectedCohortId,
            sessionDate: selectedDate,
            records: recordsPayload,
          };

      const res = await apiFetch(endpoint, {
        method,
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err: any = new Error(data.message || `Failed to save attendance (${res.status}).`);
        err.code = data.code;
        throw err;
      }

      setInitialMarksSnapshot(JSON.stringify(marksByStudentId));
      setSaveSuccessMessage(
        data.created
          ? `Attendance submitted for ${selectedDate} (${counts.present} Present, ${counts.absent} Absent).`
          : `Attendance updated for ${selectedDate} (${counts.present} Present, ${counts.absent} Absent).`
      );

      // Refresh server-backed roster, session, history, and Google Drive backup queue
      await Promise.all([
        refetchRoster(),
        refetchHistory(),
        refreshDriveBackupState({ preserveMessages: true }),
        queryClient.invalidateQueries({ queryKey: ['attendance-teacher-context'] }),
      ]);
      setStage('review');
    } catch (err: any) {
      // Preserve complete local marking state on error
      setSaveError(
        err?.message || 'Unable to save attendance. Your marked selections have been preserved.'
      );
      if (err?.code === 'EDIT_WINDOW_EXPIRED') {
        refetchRoster();
        refetchHistory();
      }
    } finally {
      isSubmittingRef.current = false;
      setIsSaving(false);
    }
  };

  // Strictly block students and CRs from accessing teacher attendance UI
  if (!isAuthorizedStaff) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            onPress={() => (onClose ? onClose() : router.replace('/(tabs)'))}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <Text variant="lg" weight="700" style={{ color: colors.text }}>
            Classroom Attendance
          </Text>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
          <EmptyState
            icon="lock-closed-outline"
            title="Faculty Access Required"
            description="Only authorized teachers and administrators can access the classroom attendance marking interface."
            actionTitle="Return to Home"
            onAction={() => (onClose ? onClose() : router.replace('/(tabs)'))}
          />
        </View>
      </View>
    );
  }

  const safeIndex = Math.min(Math.max(0, currentStudentIndex), Math.max(0, roster.length - 1));
  const currentStudent = roster[safeIndex] || null;
  const currentStudentStatus = currentStudent
    ? marksByStudentId[currentStudent.studentId] || null
    : null;
  const progressRatio = counts.total > 0 ? counts.marked / counts.total : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      {/* Top Header Bar */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() =>
            confirmNavigationWithUnsavedGuard(() => {
              if (onClose) onClose();
              else router.back();
            })
          }
          style={[styles.backBtn, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={18} color={colors.text} />
        </TouchableOpacity>

        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text variant="lg" weight="800" style={{ color: colors.text, letterSpacing: -0.3 }}>
            Classroom Attendance
          </Text>
          <Text variant="xs" color="secondary" numberOfLines={1}>
            {selectedSubject
              ? `[${selectedSubject.code}] ${selectedSubject.name}`
              : 'Faculty Attendance Workspace'}
          </Text>
        </View>
      </View>

      {isContextLoading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="small" color={colors.text} />
          <Text variant="sm" color="secondary" style={{ marginTop: 10 }}>
            Loading assigned subjects & cohorts…
          </Text>
        </View>
      ) : contextError ? (
        <View style={{ padding: 20 }}>
          <EmptyState
            icon="alert-circle-outline"
            title="Could Not Load Attendance Context"
            description={(contextError as any)?.message || 'Please check your connection and try again.'}
            actionTitle="Retry"
            onAction={() => refetchContext()}
          />
        </View>
      ) : subjects.length === 0 ? (
        <View style={{ padding: 20 }}>
          <EmptyState
            icon="school-outline"
            title="No Assigned Subjects"
            description="You do not have any active subjects assigned to your faculty profile yet."
          />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: Math.max(40, insets.bottom + 24) }}
        >
          {/* 1. Subject, Cohort, and Date Selector Card */}
          <Card variant="elevated" style={[styles.selectorCard, { borderColor: colors.border }]}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingBottom: 10 }}
            >
              {subjects.map((sub) => {
                const isSelected = sub.id === selectedSubjectId;
                return (
                  <TouchableOpacity
                    key={sub.id}
                    onPress={() => {
                      if (sub.id === selectedSubjectId) return;
                      confirmNavigationWithUnsavedGuard(() => {
                        setSelectedSubjectId(sub.id);
                        setSaveError(null);
                        setSaveSuccessMessage(null);
                      });
                    }}
                    style={[
                      styles.pillBtn,
                      {
                        backgroundColor: isSelected ? colors.text : colors.surfaceSubtle,
                        borderColor: isSelected ? colors.text : colors.border,
                      },
                    ]}
                  >
                    <Text
                      variant="xs"
                      weight="700"
                      style={{ color: isSelected ? colors.background : colors.text }}
                    >
                      [{sub.code}] {sub.name} (Sem {sub.semester})
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Cohort Selector */}
            <Text variant="xs" weight="700" color="secondary" style={[styles.sectionLabel, { marginTop: 6 }]}>
              ACTIVE COHORT (SEMESTER {selectedSubject?.semester})
            </Text>
            {eligibleCohorts.length === 0 ? (
              <View style={[styles.warningBox, { borderColor: colors.border }]}>
                <Text variant="xs" color="secondary">
                  No active student cohort is currently enrolled in Semester {selectedSubject?.semester}.
                </Text>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                {eligibleCohorts.map((c) => {
                  const isSelected = c.id === selectedCohortId;
                  return (
                    <TouchableOpacity
                      key={c.id}
                      onPress={() => {
                        if (c.id === selectedCohortId) return;
                        confirmNavigationWithUnsavedGuard(() => {
                          setSelectedCohortId(c.id);
                          setSaveError(null);
                          setSaveSuccessMessage(null);
                        });
                      }}
                      style={[
                        styles.pillBtn,
                        {
                          backgroundColor: isSelected ? colors.text : colors.surfaceSubtle,
                          borderColor: isSelected ? colors.text : colors.border,
                        },
                      ]}
                    >
                      <Text
                        variant="xs"
                        weight="700"
                        style={{ color: isSelected ? colors.background : colors.text }}
                      >
                        {c.displayName} • Sem {c.currentSemester}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Nepal Date Stepper & Picker */}
            <Text variant="xs" weight="700" color="secondary" style={[styles.sectionLabel, { marginTop: 4 }]}>
              SESSION DATE (NEPAL TIME)
            </Text>
            <View style={styles.dateRow}>
              <TouchableOpacity
                onPress={() =>
                  confirmNavigationWithUnsavedGuard(() => {
                    setSelectedDate((d) => stepNepalDate(d || currentNepalDate, -1));
                    setSaveError(null);
                    setSaveSuccessMessage(null);
                  })
                }
                style={[styles.dateStepBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
                accessibilityLabel="Previous day"
              >
                <Ionicons name="chevron-back" size={16} color={colors.text} />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setCustomDateInput(selectedDate || currentNepalDate);
                  setCustomDateModalOpen(true);
                }}
                style={[styles.dateDisplayBox, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
                accessibilityRole="button"
                accessibilityLabel="Change session date"
              >
                <Ionicons name="calendar-outline" size={15} color={colors.textSecondary} style={{ marginRight: 6 }} />
                <Text variant="sm" weight="700" style={{ color: colors.text }}>
                  {selectedDate || currentNepalDate}
                </Text>
                {selectedDate === currentNepalDate && (
                  <Badge label="TODAY" variant="neutral" size="sm" style={{ marginLeft: 8 }} />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                disabled={Boolean(currentNepalDate && selectedDate >= currentNepalDate)}
                onPress={() => {
                  if (currentNepalDate && selectedDate >= currentNepalDate) return;
                  confirmNavigationWithUnsavedGuard(() => {
                    const next = stepNepalDate(selectedDate || currentNepalDate, 1);
                    if (currentNepalDate && next > currentNepalDate) return;
                    setSelectedDate(next);
                    setSaveError(null);
                    setSaveSuccessMessage(null);
                  });
                }}
                style={[
                  styles.dateStepBtn,
                  {
                    backgroundColor: colors.surfaceSubtle,
                    borderColor: colors.border,
                    opacity: currentNepalDate && selectedDate >= currentNepalDate ? 0.35 : 1,
                  },
                ]}
                accessibilityLabel="Next day"
              >
                <Ionicons name="chevron-forward" size={16} color={colors.text} />
              </TouchableOpacity>
            </View>
          </Card>

          {/* 1b. Teacher Google Drive Attendance Backup Section */}
          {appRole === 'teacher' && backupUiModel.visible && (
            <Card
              variant="elevated"
              style={[styles.backupCard, { borderColor: colors.border }]}
            >
              <View style={styles.backupHeaderRow} testID="teacher-drive-backup-card">
                <View style={{ flex: 1, marginRight: 8 }}>
                  <View style={styles.backupTitleRow}>
                    <Ionicons
                      name="cloud-upload-outline"
                      size={16}
                      color={colors.text}
                      style={{ marginRight: 6 }}
                    />
                    <Text variant="sm" weight="800" style={{ color: colors.text }}>
                      Attendance Backup
                    </Text>
                    <Badge
                      label={backupUiModel.badgeLabel}
                      variant={backupUiModel.badgeVariant}
                      size="sm"
                      style={{ marginLeft: 8 }}
                    />
                  </View>
                  <Text variant="xs" color="secondary" style={{ marginTop: 4, lineHeight: 17 }}>
                    {backupUiModel.descriptionText}
                  </Text>
                </View>
              </View>

              {/* Connection Metadata & Counts Row */}
              {!backupUiModel.isNotConfigured && backupUiModel.uiState !== 'loading' && (
                <View style={[styles.backupMetaWrap, { borderTopColor: colors.borderSubtle }]}>
                  <Text variant="xs" color="secondary">
                    Status:{' '}
                    <Text variant="xs" weight="700" style={{ color: colors.text }}>
                      {backupUiModel.isReconnectRequired
                        ? 'Reconnection Required'
                        : backupUiModel.isConnected
                        ? 'Connected'
                        : 'Disconnected'}
                    </Text>
                  </Text>
                  {backupUiModel.googleEmail ? (
                    <Text variant="xs" color="secondary">
                      Account:{' '}
                      <Text variant="xs" weight="700" style={{ color: colors.text }}>
                        {backupUiModel.googleEmail}
                      </Text>
                    </Text>
                  ) : null}
                  {backupUiModel.lastSyncedLabel ? (
                    <Text variant="xs" color="secondary">
                      Last Synced:{' '}
                      <Text variant="xs" weight="700" style={{ color: colors.text }}>
                        {backupUiModel.lastSyncedLabel}
                      </Text>
                    </Text>
                  ) : null}
                  <Text variant="xs" color="secondary">
                    Pending:{' '}
                    <Text variant="xs" weight="700" style={{ color: colors.text }}>
                      {backupUiModel.actionableCount}
                    </Text>
                    {' • '}Backed Up:{' '}
                    <Text variant="xs" weight="700" style={{ color: colors.text }}>
                      {backupUiModel.backedUpCount}
                    </Text>
                    {backupUiModel.failedCount > 0 ? (
                      <>
                        {' • '}Failed:{' '}
                        <Text variant="xs" weight="700" style={{ color: '#fca5a5' }}>
                          {backupUiModel.failedCount}
                        </Text>
                      </>
                    ) : null}
                  </Text>
                </View>
              )}

              {/* Sanitized Error / Notice Banners */}
              {backupUiModel.effectiveErrorMessage ? (
                <View style={[styles.backupNoticeBox, styles.errorBanner]}>
                  <Text variant="xs" weight="600" style={{ color: '#fca5a5' }}>
                    {backupUiModel.effectiveErrorMessage}
                  </Text>
                </View>
              ) : null}

              {backupUiModel.effectiveNoticeMessage ? (
                <View style={[styles.backupNoticeBox, styles.successBanner]}>
                  <Text variant="xs" weight="600" style={{ color: '#86efac' }}>
                    {backupUiModel.effectiveNoticeMessage}
                  </Text>
                </View>
              ) : null}

              {/* Pending / Failed Revision Items */}
              {!backupUiModel.isNotConfigured && backupUiModel.attentionRuns.length > 0 && (
                <View style={styles.backupPendingList}>
                  {backupUiModel.attentionRuns.map((run) => (
                    <View
                      key={run.id}
                      style={[
                        styles.backupPendingItem,
                        { backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
                      ]}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                        <Text variant="xs" weight="700" style={{ color: colors.text }}>
                          {run.subjectCode}
                          {run.cohortName ? ` • ${run.cohortName}` : ''} • {run.sessionDate} (v{run.revisionNo})
                        </Text>
                      </View>
                      {run.lastErrorMessage ? (
                        <Text variant="xs" style={{ color: '#fca5a5', marginTop: 2 }}>
                          {run.lastErrorMessage}
                        </Text>
                      ) : null}
                      <View style={styles.backupArtPillsRow}>
                        <View
                          style={[
                            styles.backupArtPill,
                            {
                              borderColor:
                                run.snapshotStatus === 'failed' || run.snapshotStatus === 'reconnect_required'
                                  ? '#ef4444'
                                  : colors.border,
                              backgroundColor:
                                run.snapshotStatus === 'backed_up'
                                  ? colors.text
                                  : colors.surfaceRaised,
                            },
                          ]}
                        >
                          <Text
                            variant="xs"
                            weight="600"
                            style={{
                              fontSize: 10,
                              color:
                                run.snapshotStatus === 'backed_up'
                                  ? colors.background
                                  : colors.textSecondary,
                            }}
                          >
                            Snapshot: {run.snapshotStatus}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.backupArtPill,
                            {
                              borderColor:
                                run.dailyWorkbookStatus === 'failed' ||
                                run.dailyWorkbookStatus === 'reconnect_required'
                                  ? '#ef4444'
                                  : colors.border,
                              backgroundColor:
                                run.dailyWorkbookStatus === 'backed_up' ||
                                run.dailyWorkbookStatus === 'superseded'
                                  ? colors.text
                                  : colors.surfaceRaised,
                            },
                          ]}
                        >
                          <Text
                            variant="xs"
                            weight="600"
                            style={{
                              fontSize: 10,
                              color:
                                run.dailyWorkbookStatus === 'backed_up' ||
                                run.dailyWorkbookStatus === 'superseded'
                                  ? colors.background
                                  : colors.textSecondary,
                            }}
                          >
                            Daily XLSX: {run.dailyWorkbookStatus}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.backupArtPill,
                            {
                              borderColor:
                                run.annualWorkbookStatus === 'failed' ||
                                run.annualWorkbookStatus === 'reconnect_required'
                                  ? '#ef4444'
                                  : colors.border,
                              backgroundColor:
                                run.annualWorkbookStatus === 'backed_up' ||
                                run.annualWorkbookStatus === 'superseded'
                                  ? colors.text
                                  : colors.surfaceRaised,
                            },
                          ]}
                        >
                          <Text
                            variant="xs"
                            weight="600"
                            style={{
                              fontSize: 10,
                              color:
                                run.annualWorkbookStatus === 'backed_up' ||
                                run.annualWorkbookStatus === 'superseded'
                                  ? colors.background
                                  : colors.textSecondary,
                            }}
                          >
                            Annual XLSX: {run.annualWorkbookStatus}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {/* Action Buttons Row */}
              {!backupUiModel.isNotConfigured && (
                <View style={styles.backupActionsRow}>
                  {backupUiModel.isBusy ? (
                    <View
                      style={[
                        styles.backupPrimaryBtn,
                        { backgroundColor: colors.surfaceSubtle, borderColor: colors.border, opacity: 0.7 },
                      ]}
                    >
                      <ActivityIndicator size="small" color={colors.text} style={{ marginRight: 8 }} />
                      <Text variant="xs" weight="700" style={{ color: colors.text }}>
                        {isBackupConnecting
                          ? 'Connecting Google Drive…'
                          : isBackupSyncing
                          ? 'Syncing Backups…'
                          : isBackupDisconnecting
                          ? 'Disconnecting…'
                          : 'Loading…'}
                      </Text>
                    </View>
                  ) : backupUiModel.canConnect ? (
                    <TouchableOpacity
                      onPress={handleConnectDriveBackup}
                      style={[styles.backupPrimaryBtn, { backgroundColor: colors.text, borderColor: colors.text }]}
                      accessibilityRole="button"
                      accessibilityLabel="Connect Google Drive"
                      testID="btn-connect-drive-backup"
                    >
                      <Ionicons name="logo-google" size={14} color={colors.background} style={{ marginRight: 6 }} />
                      <Text variant="xs" weight="800" style={{ color: colors.background }}>
                        Connect Google Drive
                      </Text>
                    </TouchableOpacity>
                  ) : backupUiModel.canReconnect ? (
                    <>
                      <TouchableOpacity
                        onPress={handleConnectDriveBackup}
                        style={[styles.backupPrimaryBtn, { backgroundColor: colors.text, borderColor: colors.text }]}
                        accessibilityRole="button"
                        accessibilityLabel="Reconnect Google Drive"
                        testID="btn-reconnect-drive-backup"
                      >
                        <Ionicons name="refresh" size={14} color={colors.background} style={{ marginRight: 6 }} />
                        <Text variant="xs" weight="800" style={{ color: colors.background }}>
                          Reconnect Google Drive
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={handleDisconnectDriveBackup}
                        style={[styles.backupSecondaryBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
                        accessibilityRole="button"
                        accessibilityLabel="Disconnect Google Drive"
                        testID="btn-disconnect-drive-backup"
                      >
                        <Text variant="xs" weight="700" style={{ color: colors.textSecondary }}>
                          Disconnect Google Drive
                        </Text>
                      </TouchableOpacity>
                    </>
                  ) : backupUiModel.isConnected ? (
                    <>
                      <TouchableOpacity
                        onPress={() =>
                          handleSyncDriveBackup({ forceRetry: backupUiModel.canRetry })
                        }
                        style={[styles.backupPrimaryBtn, { backgroundColor: colors.text, borderColor: colors.text }]}
                        accessibilityRole="button"
                        accessibilityLabel={backupUiModel.canRetry ? 'Retry Sync' : 'Sync Now'}
                        testID={backupUiModel.canRetry ? 'btn-retry-drive-backup' : 'btn-sync-drive-backup'}
                      >
                        <Ionicons
                          name={backupUiModel.canRetry ? 'refresh' : 'sync-outline'}
                          size={14}
                          color={colors.background}
                          style={{ marginRight: 6 }}
                        />
                        <Text variant="xs" weight="800" style={{ color: colors.background }}>
                          {backupUiModel.canRetry ? 'Retry Sync' : 'Sync Now'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={handleDisconnectDriveBackup}
                        style={[styles.backupSecondaryBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
                        accessibilityRole="button"
                        accessibilityLabel="Disconnect Google Drive"
                        testID="btn-disconnect-drive-backup"
                      >
                        <Text variant="xs" weight="700" style={{ color: colors.textSecondary }}>
                          Disconnect Google Drive
                        </Text>
                      </TouchableOpacity>
                    </>
                  ) : null}
                </View>
              )}
            </Card>
          )}

          {/* 2. Stage Tabs: Marking | Review & Submit | History */}
          <View style={styles.stageTabsRow}>
            <TouchableOpacity
              onPress={() => setStage('marking')}
              style={[
                styles.stageTabBtn,
                {
                  backgroundColor: stage === 'marking' ? colors.text : colors.surfaceRaised,
                  borderColor: stage === 'marking' ? colors.text : colors.border,
                },
              ]}
            >
              <Text
                variant="xs"
                weight="700"
                style={{ color: stage === 'marking' ? colors.background : colors.textSecondary }}
              >
                1. Mark ({counts.marked}/{counts.total})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setStage('review')}
              style={[
                styles.stageTabBtn,
                {
                  backgroundColor: stage === 'review' ? colors.text : colors.surfaceRaised,
                  borderColor: stage === 'review' ? colors.text : colors.border,
                },
              ]}
            >
              <Text
                variant="xs"
                weight="700"
                style={{ color: stage === 'review' ? colors.background : colors.textSecondary }}
              >
                2. Review ({counts.unmarked === 0 && counts.total > 0 ? 'Ready' : `${counts.unmarked} left`})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setStage('history');
                refetchHistory();
              }}
              style={[
                styles.stageTabBtn,
                {
                  backgroundColor: stage === 'history' ? colors.text : colors.surfaceRaised,
                  borderColor: stage === 'history' ? colors.text : colors.border,
                },
              ]}
            >
              <Text
                variant="xs"
                weight="700"
                style={{ color: stage === 'history' ? colors.background : colors.textSecondary }}
              >
                3. History ({historyData?.sessions?.length || 0})
              </Text>
            </TouchableOpacity>
          </View>

          {/* 3. Existing Session & 24h Edit Window Banner */}
          {existingSession && (
            <View
              style={[
                styles.statusBanner,
                {
                  borderColor: isReadOnly ? '#f59e0b' : colors.border,
                  backgroundColor: isReadOnly ? 'rgba(245, 158, 11, 0.12)' : colors.surfaceRaised,
                },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text variant="xs" weight="800" style={{ color: isReadOnly ? '#fde68a' : colors.text }}>
                  {isReadOnly ? 'LOCKED / READ-ONLY SESSION' : 'SUBMITTED SESSION'}
                </Text>
                <Badge label={editWindowInfo.label} variant="neutral" size="sm" />
              </View>
              <Text variant="xs" color="secondary">
                {isReadOnly
                  ? 'The 24-hour teacher editing window has expired. An administrator must authorize any post-window corrections.'
                  : 'Saved attendance loaded from server. You can review or edit entries while the 24-hour window remains open.'}
              </Text>
            </View>
          )}

          {saveError && (
            <View style={[styles.statusBanner, styles.errorBanner]}>
              <Text variant="xs" weight="700" style={{ color: '#fca5a5' }}>
                {saveError}
              </Text>
            </View>
          )}

          {saveSuccessMessage && (
            <View style={[styles.statusBanner, styles.successBanner]}>
              <Text variant="xs" weight="700" style={{ color: '#86efac' }}>
                {saveSuccessMessage}
              </Text>
            </View>
          )}

          {/* 4. Main Content Area by Stage */}
          {stage === 'history' ? (
            isHistoryLoading ? (
              <View style={styles.centerBox}>
                <ActivityIndicator size="small" color={colors.text} />
                <Text variant="xs" color="secondary" style={{ marginTop: 8 }}>
                  Loading session history…
                </Text>
              </View>
            ) : !historyData?.sessions?.length ? (
              <EmptyState
                icon="time-outline"
                title="No Sessions Recorded Yet"
                description="Submitted attendance sessions for this subject will appear here with present/absent totals and edit timers."
              />
            ) : (
              historyData.sessions.map((sess) => {
                const win = computeLiveEditWindow(sess, nowTick);
                const c = sess.counts || { total: 0, present: 0, absent: 0, attendancePercentage: 0 };
                return (
                  <Card
                    key={sess.id}
                    variant="elevated"
                    style={[styles.historyCard, { borderColor: colors.border }]}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text variant="md" weight="700" style={{ color: colors.text }}>
                        {sess.sessionDate} • {sess.cohortName || 'Cohort'}
                      </Text>
                      <Badge label={`${c.attendancePercentage}%`} variant="neutral" size="sm" />
                    </View>
                    <Text variant="xs" color="secondary" style={{ marginTop: 4 }}>
                      Present: {c.present} • Absent: {c.absent} • Total: {c.total}
                    </Text>
                    <Text variant="xs" color="secondary" style={{ marginTop: 2 }}>
                      {win.label}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                      <TouchableOpacity
                        onPress={() =>
                          confirmNavigationWithUnsavedGuard(() => {
                            if (sess.cohortId) setSelectedCohortId(sess.cohortId);
                            setSelectedDate(sess.sessionDate);
                            setStage('review');
                          })
                        }
                        style={[styles.smallActionBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
                      >
                        <Text variant="xs" weight="700" style={{ color: colors.text }}>
                          {win.canEdit ? 'Review / Edit' : 'View Read-Only'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => setAuditModalSessionId(sess.id)}
                        style={[styles.smallActionBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
                      >
                        <Text variant="xs" weight="700" style={{ color: colors.textSecondary }}>
                          Audit Log
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </Card>
                );
              })
            )
          ) : !selectedCohortId ? null : isRosterLoading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="small" color={colors.text} />
              <Text variant="sm" color="secondary" style={{ marginTop: 8 }}>
                Loading class roster…
              </Text>
            </View>
          ) : rosterError ? (
            <EmptyState
              icon="alert-circle-outline"
              title="Roster Unavailable"
              description={(rosterError as any)?.message || 'Failed to load class roster.'}
              actionTitle="Try Again"
              onAction={() => refetchRoster()}
            />
          ) : roster.length === 0 ? (
            <EmptyState
              icon="people-outline"
              title="Empty Cohort Roster"
              description="No active students are currently assigned to this cohort."
            />
          ) : stage === 'marking' && currentStudent ? (
            /* STAGE 1: ONE-STUDENT-AT-A-TIME MARKING INTERFACE */
            <Card variant="elevated" style={[styles.focusCard, { borderColor: colors.border }]}>
              <View style={styles.countsStrip}>
                <Text variant="xs" weight="700" color="secondary">
                  Student {safeIndex + 1} of {counts.total}
                </Text>
                <Text variant="xs" weight="700" color="secondary">
                  Present: {counts.present} • Absent: {counts.absent} • Unmarked: {counts.unmarked}
                </Text>
              </View>

              <View style={[styles.progressBarBg, { backgroundColor: colors.surfaceSubtle }]}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${Math.round(progressRatio * 100)}%`,
                      backgroundColor: colors.text,
                    },
                  ]}
                />
              </View>

              <View style={[styles.studentAvatarCircle, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
                <Text variant="xl" weight="800" style={{ color: colors.text }}>
                  {(currentStudent.name || 'S').charAt(0).toUpperCase()}
                </Text>
              </View>

              <Text variant="xl" weight="800" style={{ color: colors.text, textAlign: 'center' }}>
                {currentStudent.name}
              </Text>
              <Text variant="xs" color="secondary" style={{ textAlign: 'center', marginTop: 4, marginBottom: 20 }}>
                ID: {currentStudent.studentId}
                {currentStudent.username ? ` • @${currentStudent.username}` : ''}
                {currentStudent.role === 'cr' ? ' • CR' : ''}
              </Text>

              {/* Mutually Exclusive Present / Absent Buttons */}
              <View style={styles.markBtnRow}>
                <TouchableOpacity
                  disabled={isReadOnly || isSaving}
                  onPress={() => handleSelectStatus(currentStudent.studentId, 'present', true)}
                  style={[
                    styles.markBtn,
                    {
                      backgroundColor:
                        currentStudentStatus === 'present' ? '#f5f5f5' : colors.surfaceSubtle,
                      borderColor:
                        currentStudentStatus === 'present' ? '#f5f5f5' : colors.border,
                      opacity: isReadOnly ? 0.5 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Mark ${currentStudent.name} Present`}
                  accessibilityState={{ selected: currentStudentStatus === 'present' }}
                >
                  <Ionicons
                    name="checkmark-circle"
                    size={20}
                    color={currentStudentStatus === 'present' ? '#0a0a0a' : colors.text}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    variant="md"
                    weight="800"
                    style={{
                      color: currentStudentStatus === 'present' ? '#0a0a0a' : colors.text,
                    }}
                  >
                    Present
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  disabled={isReadOnly || isSaving}
                  onPress={() => handleSelectStatus(currentStudent.studentId, 'absent', true)}
                  style={[
                    styles.markBtn,
                    {
                      backgroundColor:
                        currentStudentStatus === 'absent'
                          ? 'rgba(239, 68, 68, 0.2)'
                          : colors.surfaceSubtle,
                      borderColor:
                        currentStudentStatus === 'absent' ? '#ef4444' : colors.border,
                      opacity: isReadOnly ? 0.5 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Mark ${currentStudent.name} Absent`}
                  accessibilityState={{ selected: currentStudentStatus === 'absent' }}
                >
                  <Ionicons
                    name="close-circle"
                    size={20}
                    color={currentStudentStatus === 'absent' ? '#fca5a5' : colors.text}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    variant="md"
                    weight="800"
                    style={{
                      color: currentStudentStatus === 'absent' ? '#fca5a5' : colors.text,
                    }}
                  >
                    Absent
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Previous / Next Student Navigation */}
              <View style={[styles.navRow, { borderTopColor: colors.borderSubtle }]}>
                <TouchableOpacity
                  disabled={safeIndex === 0}
                  onPress={() => setCurrentStudentIndex((i) => Math.max(0, i - 1))}
                  style={[
                    styles.smallActionBtn,
                    {
                      backgroundColor: colors.surfaceSubtle,
                      borderColor: colors.border,
                      opacity: safeIndex === 0 ? 0.4 : 1,
                    },
                  ]}
                >
                  <Text variant="xs" weight="700" style={{ color: colors.text }}>
                    ← Previous
                  </Text>
                </TouchableOpacity>

                <Text variant="xs" color="secondary" weight="600">
                  {currentStudentStatus ? currentStudentStatus.toUpperCase() : 'UNMARKED'}
                </Text>

                {safeIndex < counts.total - 1 ? (
                  <TouchableOpacity
                    onPress={() =>
                      setCurrentStudentIndex((i) => Math.min(counts.total - 1, i + 1))
                    }
                    style={[
                      styles.smallActionBtn,
                      { backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="700" style={{ color: colors.text }}>
                      Next →
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    onPress={() => setStage('review')}
                    style={[
                      styles.smallActionBtn,
                      { backgroundColor: colors.text, borderColor: colors.text },
                    ]}
                  >
                    <Text variant="xs" weight="700" style={{ color: colors.background }}>
                      Review Roster →
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Numbered Student Jump Strip */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6, paddingTop: 14 }}
              >
                {roster.map((s, sIdx) => {
                  const st = marksByStudentId[s.studentId];
                  const isCur = sIdx === safeIndex;
                  return (
                    <TouchableOpacity
                      key={s.studentId}
                      onPress={() => setCurrentStudentIndex(sIdx)}
                      accessibilityRole="button"
                      accessibilityLabel={`Jump to student ${sIdx + 1}: ${s.name}`}
                      style={[
                        styles.smallActionBtn,
                        {
                          minWidth: 34,
                          paddingHorizontal: 8,
                          backgroundColor:
                            st === 'present'
                              ? '#f5f5f5'
                              : st === 'absent'
                              ? 'rgba(239, 68, 68, 0.2)'
                              : colors.surfaceSubtle,
                          borderColor: isCur
                            ? colors.text
                            : st === 'absent'
                            ? '#ef4444'
                            : colors.border,
                          borderWidth: isCur ? 2 : 1,
                        },
                      ]}
                    >
                      <Text
                        variant="xs"
                        weight="700"
                        style={{
                          color:
                            st === 'present'
                              ? '#0a0a0a'
                              : st === 'absent'
                              ? '#fca5a5'
                              : colors.textSecondary,
                        }}
                      >
                        {sIdx + 1}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </Card>
          ) : (
            /* STAGE 2: REVIEW & FINAL CONFIRMATION */
            <Card variant="elevated" style={[styles.selectorCard, { borderColor: colors.border }]}>
              <View style={styles.reviewSummaryGrid}>
                <View style={[styles.statPillBox, { backgroundColor: colors.surfaceSubtle }]}>
                  <Text variant="md" weight="800" style={{ color: colors.text }}>
                    {counts.total}
                  </Text>
                  <Text variant="xs" color="secondary">
                    Total
                  </Text>
                </View>
                <View style={[styles.statPillBox, { backgroundColor: colors.surfaceSubtle }]}>
                  <Text variant="md" weight="800" style={{ color: colors.text }}>
                    {counts.marked}
                  </Text>
                  <Text variant="xs" color="secondary">
                    Marked
                  </Text>
                </View>
                <View style={[styles.statPillBox, { backgroundColor: colors.surfaceSubtle }]}>
                  <Text variant="md" weight="800" style={{ color: '#86efac' }}>
                    {counts.present}
                  </Text>
                  <Text variant="xs" color="secondary">
                    Present
                  </Text>
                </View>
                <View style={[styles.statPillBox, { backgroundColor: colors.surfaceSubtle }]}>
                  <Text variant="md" weight="800" style={{ color: '#fca5a5' }}>
                    {counts.absent}
                  </Text>
                  <Text variant="xs" color="secondary">
                    Absent
                  </Text>
                </View>
                <View style={[styles.statPillBox, { backgroundColor: colors.surfaceSubtle }]}>
                  <Text variant="md" weight="800" style={{ color: '#fde68a' }}>
                    {counts.unmarked}
                  </Text>
                  <Text variant="xs" color="secondary">
                    Unmarked
                  </Text>
                </View>
              </View>

              {roster.map((student, idx) => {
                const st = marksByStudentId[student.studentId] || null;
                return (
                  <View
                    key={student.studentId}
                    style={[styles.reviewRow, { borderBottomColor: colors.borderSubtle }]}
                  >
                    <TouchableOpacity
                      style={{ flex: 1, marginRight: 8 }}
                      onPress={() => {
                        setCurrentStudentIndex(idx);
                        setStage('marking');
                      }}
                    >
                      <Text variant="sm" weight="700" style={{ color: colors.text }}>
                        {idx + 1}. {student.name}
                      </Text>
                      <Text variant="xs" color="secondary">
                        {student.studentId}
                      </Text>
                    </TouchableOpacity>

                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {!isReadOnly ? (
                        <>
                          <TouchableOpacity
                            disabled={isSaving}
                            onPress={() => handleSelectStatus(student.studentId, 'present', false)}
                            style={[
                              styles.miniToggleBtn,
                              {
                                backgroundColor:
                                  st === 'present' ? '#f5f5f5' : colors.surfaceSubtle,
                                borderColor: st === 'present' ? '#f5f5f5' : colors.border,
                              },
                            ]}
                          >
                            <Text
                              variant="xs"
                              weight="700"
                              style={{ color: st === 'present' ? '#0a0a0a' : colors.textSecondary }}
                            >
                              Present
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            disabled={isSaving}
                            onPress={() => handleSelectStatus(student.studentId, 'absent', false)}
                            style={[
                              styles.miniToggleBtn,
                              {
                                backgroundColor:
                                  st === 'absent'
                                    ? 'rgba(239, 68, 68, 0.2)'
                                    : colors.surfaceSubtle,
                                borderColor: st === 'absent' ? '#ef4444' : colors.border,
                              },
                            ]}
                          >
                            <Text
                              variant="xs"
                              weight="700"
                              style={{ color: st === 'absent' ? '#fca5a5' : colors.textSecondary }}
                            >
                              Absent
                            </Text>
                          </TouchableOpacity>
                        </>
                      ) : (
                        <Badge
                          label={st ? st.toUpperCase() : 'UNMARKED'}
                          variant="neutral"
                          size="sm"
                        />
                      )}
                    </View>
                  </View>
                );
              })}

              {!isReadOnly && (
                <View style={{ marginTop: 16 }}>
                  {counts.unmarked > 0 && (
                    <Text
                      variant="xs"
                      color="secondary"
                      style={{ textAlign: 'center', marginBottom: 10 }}
                    >
                      Mark all remaining {counts.unmarked} unmarked student
                      {counts.unmarked === 1 ? '' : 's'} to enable submission.
                    </Text>
                  )}

                  <TouchableOpacity
                    disabled={isSaving || counts.unmarked > 0 || counts.total === 0}
                    onPress={handleSubmitAttendance}
                    style={[
                      styles.submitBtn,
                      {
                        backgroundColor: colors.text,
                        opacity:
                          isSaving || counts.unmarked > 0 || counts.total === 0 ? 0.4 : 1,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={
                      existingSession ? 'Save Attendance Changes' : 'Confirm and Submit Attendance'
                    }
                  >
                    {isSaving ? (
                      <ActivityIndicator size="small" color={colors.background} />
                    ) : (
                      <Text variant="sm" weight="800" style={{ color: colors.background }}>
                        {existingSession
                          ? 'Save Attendance Changes'
                          : 'Confirm & Submit Attendance'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </Card>
          )}
        </ScrollView>
      )}

      {/* Custom Date Input Modal */}
      <Modal
        visible={customDateModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCustomDateModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text variant="md" weight="700" style={{ color: colors.text, marginBottom: 6 }}>
              Select Session Date (YYYY-MM-DD)
            </Text>
            <Text variant="xs" color="secondary" style={{ marginBottom: 12 }}>
              Nepal Current Date: {currentNepalDate}. Future dates are not permitted.
            </Text>
            <TextInput
              value={customDateInput}
              onChangeText={setCustomDateInput}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              style={[
                styles.modalInput,
                {
                  color: colors.text,
                  borderColor: colors.border,
                  backgroundColor: colors.surfaceSubtle,
                },
              ]}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <TouchableOpacity
                onPress={() => setCustomDateModalOpen(false)}
                style={[styles.smallActionBtn, { borderColor: colors.border }]}
              >
                <Text variant="xs" weight="600" color="secondary">
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const trimmed = customDateInput.trim();
                  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
                    Alert.alert('Invalid Date Format', 'Please enter a valid date in YYYY-MM-DD format.');
                    return;
                  }
                  const [y, m, d] = trimmed.split('-').map(Number);
                  const parsedUtc = new Date(Date.UTC(y, m - 1, d));
                  if (
                    Number.isNaN(parsedUtc.getTime()) ||
                    parsedUtc.getUTCFullYear() !== y ||
                    parsedUtc.getUTCMonth() + 1 !== m ||
                    parsedUtc.getUTCDate() !== d
                  ) {
                    Alert.alert('Invalid Calendar Date', `"${trimmed}" is not a valid calendar date.`);
                    return;
                  }
                  if (currentNepalDate && trimmed > currentNepalDate) {
                    Alert.alert(
                      'Future Date Not Allowed',
                      `Cannot select a future date (${trimmed}). Current Nepal date is ${currentNepalDate}.`
                    );
                    return;
                  }
                  setCustomDateModalOpen(false);
                  if (trimmed !== selectedDate) {
                    confirmNavigationWithUnsavedGuard(() => {
                      setSelectedDate(trimmed);
                      setSaveError(null);
                      setSaveSuccessMessage(null);
                    });
                  }
                }}
                style={[styles.smallActionBtn, { backgroundColor: colors.text, borderColor: colors.text }]}
              >
                <Text variant="xs" weight="700" style={{ color: colors.background }}>
                  Apply Date
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Read-Only Audit Trail Modal */}
      <Modal
        visible={Boolean(auditModalSessionId)}
        transparent
        animationType="fade"
        onRequestClose={() => setAuditModalSessionId(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text variant="md" weight="700" style={{ color: colors.text }}>
                Session Audit History
              </Text>
              <TouchableOpacity onPress={() => setAuditModalSessionId(null)}>
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            {isAuditLoading ? (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={colors.text} />
              </View>
            ) : !auditData?.logs?.length ? (
              <Text variant="xs" color="secondary">
                No audit entries found for this session.
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 280 }}>
                {auditData.logs.map((log) => (
                  <View
                    key={log.id}
                    style={{
                      paddingVertical: 8,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.borderSubtle,
                    }}
                  >
                    <Text variant="xs" weight="700" style={{ color: colors.text }}>
                      {log.action} • {log.actorName || log.actorUserId} ({log.actorRole})
                    </Text>
                    <Text variant="xs" color="secondary" style={{ marginTop: 2 }}>
                      {log.createdAt}
                      {log.reason ? ` • ${log.reason}` : ''}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerBox: {
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectorCard: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    backgroundColor: '#121212',
  },
  sectionLabel: {
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  pillBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  warningBox: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateStepBtn: {
    width: 38,
    height: 38,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateDisplayBox: {
    flex: 1,
    height: 38,
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageTabsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  stageTabBtn: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBanner: {
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    marginBottom: 14,
  },
  errorBanner: {
    borderColor: 'rgba(239, 68, 68, 0.5)',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  successBanner: {
    borderColor: 'rgba(34, 197, 94, 0.5)',
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
  },
  focusCard: {
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    backgroundColor: '#121212',
    alignItems: 'center',
  },
  countsStrip: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressBarBg: {
    width: '100%',
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 20,
  },
  progressBarFill: {
    height: '100%',
  },
  studentAvatarCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  markBtnRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  markBtn: {
    flex: 1,
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  smallActionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  reviewSummaryGrid: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 14,
  },
  statPillBox: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  miniToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  submitBtn: {
    width: '100%',
    height: 46,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backupCard: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    backgroundColor: '#121212',
  },
  backupHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  backupTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  backupMetaWrap: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 3,
  },
  backupNoticeBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  backupPendingList: {
    marginTop: 10,
    gap: 8,
  },
  backupPendingItem: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  backupArtPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  backupArtPill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
    borderWidth: 1,
  },
  backupActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  backupPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 9,
    borderWidth: 1,
  },
  backupSecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 9,
    borderWidth: 1,
  },
  historyCard: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    backgroundColor: '#121212',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    padding: 20,
  },
  modalBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 18,
  },
  modalInput: {
    height: 42,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
});
