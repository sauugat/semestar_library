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
import { adToBs, bsToAd, formatBsDate } from '@/utils/nepaliDate';

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

type SubjectTab = 'students' | 'history';
type HistoryViewMode = 'days' | 'students';

interface StudentAttendanceOverview {
  studentId: string;
  name: string;
  username?: string | null;
  role?: string;
  overallTotalSessions: number;
  overallPresentCount: number;
  overallAbsentCount: number;
  overallAttendancePercentage: number;
  overallFormattedPercentage: string;
}

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

  // Selection state: starts empty on subject list unless deep-linked with initialSubjectId
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');
  const [selectedCohortId, setSelectedCohortId] = useState<string>(initialCohortId || '');
  // Internal date stays AD (YYYY-MM-DD) for backend API contracts; all UI displays BS.
  const [selectedDate, setSelectedDate] = useState<string>(initialDate || '');
  const [customDateModalOpen, setCustomDateModalOpen] = useState(false);
  const [customDateInput, setCustomDateInput] = useState('');
  const [backupModalOpen, setBackupModalOpen] = useState(false);

  const selectedMonth =
    selectedDate && /^\d{4}-\d{2}/.test(selectedDate) ? selectedDate.slice(0, 7) : null;

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

  // Active tab, focused student index, and post-save screen state
  const [activeTab, setActiveTab] = useState<SubjectTab>('students');
  const [historyMode, setHistoryMode] = useState<HistoryViewMode>('days');
  const [currentStudentIndex, setCurrentStudentIndex] = useState<number>(0);
  const [isEditingExisting, setIsEditingExisting] = useState<boolean>(false);
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
      const res: any = await mobileAttendanceDriveSync.connectGoogleDrive({ subjects });
      if (!isMountedRef.current) return;

      if (res?.notConfigured || res?.status === 'not_configured') {
        setIsBackupConnecting(false);
        await refreshDriveBackupState({ preserveMessages: true });
        return;
      }

      setIsBackupConnecting(false);
      setBackupReconnectRequired(false);
      setBackupNoticeMessage(
        'Google Drive connected and backup folders for all assigned subjects verified.'
      );
      await refreshDriveBackupState({ preserveMessages: true });

      mobileAttendanceDriveSync
        .syncAllAssignedSubjectsToDrive({
          subjects,
          date: selectedDate,
          month: selectedMonth,
        })
        .then(() => refreshDriveBackupState({ preserveMessages: true }))
        .catch(() => {});
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
    subjects,
    selectedDate,
    selectedMonth,
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

        if (selectedSubjectId) {
          const subObj = subjects.find((s) => s.id === selectedSubjectId);
          await mobileAttendanceDriveSync
            .syncSubjectAttendanceToDrive({
              subjectId: selectedSubjectId,
              cohortId: selectedCohortId,
              subjectName: subObj?.name || selectedSubjectId,
              date: selectedDate,
              month: selectedMonth,
            })
            .catch(() => {});
        }

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
      selectedSubjectId,
      selectedCohortId,
      subjects,
      selectedDate,
      selectedMonth,
    ]
  );

  const handleSyncAllSubjectsDriveBackup = useCallback(async () => {
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
      await mobileAttendanceDriveSync.syncPendingWork({ forceRetry: true });
      const syncResult: any = await mobileAttendanceDriveSync.syncAllAssignedSubjectsToDrive({
        subjects,
        date: selectedDate,
        month: selectedMonth,
      });

      if (!isMountedRef.current) return;
      setIsBackupSyncing(false);

      if (syncResult?.synced) {
        setBackupNoticeMessage(
          `All ${syncResult.total} assigned subjects are synced to your Google Drive.`
        );
      } else if (syncResult?.completed > 0) {
        setBackupNoticeMessage(
          `Synced ${syncResult.completed} of ${syncResult.total} subjects to your Google Drive.`
        );
      } else if (syncResult?.message) {
        setBackupErrorMessage(sanitizeClientErrorMessage(syncResult.message));
      }
      await refreshDriveBackupState({ preserveMessages: true });
    } catch (err: any) {
      if (!isMountedRef.current) return;
      setIsBackupSyncing(false);
      setBackupErrorMessage(sanitizeClientErrorMessage(err?.message));
      await refreshDriveBackupState({ preserveMessages: true });
    } finally {
      isBackupActionInFlightRef.current = false;
    }
  }, [
    isBackupConnecting,
    isBackupSyncing,
    isBackupDisconnecting,
    refreshDriveBackupState,
    subjects,
    selectedDate,
    selectedMonth,
  ]);

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

  const handleBackToSubjects = useCallback(() => {
    confirmNavigationWithUnsavedGuard(() => {
      setSelectedSubjectId('');
      setSelectedCohortId('');
      setMarksByStudentId({});
      setInitialMarksSnapshot('{}');
      setCurrentStudentIndex(0);
      setIsEditingExisting(false);
      setSaveError(null);
      setSaveSuccessMessage(null);
      setActiveTab('students');
    });
  }, [confirmNavigationWithUnsavedGuard]);

  // Hardware back button on Android: return to Subject List first, or exit screen
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectedSubjectId) {
        handleBackToSubjects();
        return true;
      }
      if (!hasUnsavedChanges) return false;
      confirmNavigationWithUnsavedGuard(() => {
        if (onClose) onClose();
        else router.back();
      });
      return true;
    });
    return () => sub.remove();
  }, [
    selectedSubjectId,
    handleBackToSubjects,
    hasUnsavedChanges,
    confirmNavigationWithUnsavedGuard,
    onClose,
  ]);

  // Initialize default Nepal date and optional deep-linked initialSubjectId (once)
  useEffect(() => {
    if (!contextData) return;

    if (!selectedDate && contextData.currentNepalDate) {
      setSelectedDate(contextData.currentNepalDate);
    }

    if (subjects.length > 0 && initialSubjectId && !didApplyInitialSubjectRef.current) {
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
      }
    }
  }, [contextData, subjects, initialSubjectId, selectedDate]);

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
    if (!selectedSubjectId) return;
    if (eligibleCohorts.length === 0) {
      if (selectedCohortId !== '') setSelectedCohortId('');
      return;
    }
    const stillValid = eligibleCohorts.some((c) => c.id === selectedCohortId);
    if (!stillValid) {
      setSelectedCohortId(eligibleCohorts[0].id);
    }
  }, [selectedSubjectId, eligibleCohorts, selectedCohortId]);

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

  // 3b. Fetch Per-Student Overall Attendance Summary: GET /api/attendance/monthly
  const {
    data: studentSummaryData,
    isLoading: isStudentSummaryLoading,
    error: studentSummaryError,
    refetch: refetchStudentSummary,
  } = useQuery<{ studentHistory?: Record<string, StudentAttendanceOverview> }>({
    queryKey: ['attendance-student-summary', user?.studentId, selectedSubjectId, selectedCohortId],
    queryFn: async () => {
      const qs = new URLSearchParams({
        subjectId: selectedSubjectId,
        cohortId: selectedCohortId,
      });
      const res = await apiFetch(`/api/attendance/monthly?${qs.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.message || 'Failed to load student attendance summary.');
      }
      return json;
    },
    enabled: Boolean(
      isAuthorizedStaff &&
        selectedSubjectId &&
        selectedCohortId &&
        activeTab === 'history' &&
        historyMode === 'students'
    ),
    staleTime: 15 * 1000,
  });

  const studentSummaries = useMemo(() => {
    const map = studentSummaryData?.studentHistory;
    if (!map || typeof map !== 'object') return [];
    return Object.values(map).sort((a, b) => {
      const nameA = String(a?.name || a?.studentId || '').trim();
      const nameB = String(b?.name || b?.studentId || '').trim();
      const cmp = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
      if (cmp !== 0) return cmp;
      return String(a?.studentId || '').localeCompare(String(b?.studentId || ''), undefined, {
        sensitivity: 'base',
      });
    });
  }, [studentSummaryData?.studentHistory]);

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

    const attendancePercentage =
      total > 0 ? Math.round((present / total) * 1000) / 10 : 0;

    return {
      total,
      marked: present + absent,
      present,
      absent,
      unmarked,
      attendancePercentage,
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

    if (autoAdvance && roster.length > 0 && currentStudentIndex < roster.length - 1) {
      setCurrentStudentIndex((idx) => Math.min(roster.length - 1, idx + 1));
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
      const bsLabel = formatBsDate(selectedDate);
      setSaveSuccessMessage(
        data.created
          ? `Attendance saved for ${bsLabel} (${counts.present} Present, ${counts.absent} Absent).`
          : `Attendance updated for ${bsLabel} (${counts.present} Present, ${counts.absent} Absent).`
      );

      await Promise.all([
        refetchRoster(),
        refetchHistory(),
        refreshDriveBackupState({ preserveMessages: true }),
        queryClient.invalidateQueries({ queryKey: ['attendance-teacher-context'] }),
        queryClient.invalidateQueries({ queryKey: ['attendance-student-summary'] }),
      ]);

      // Transition to dedicated Attendance Saved page with Done & Edit Attendance buttons
      setIsEditingExisting(false);

      if (backupStatusData?.connection?.connectionStatus === 'connected') {
        (async () => {
          try {
            await mobileAttendanceDriveSync.syncPendingWork();
            if (selectedSubjectId) {
              const subObj = subjects.find((s) => s.id === selectedSubjectId);
              await mobileAttendanceDriveSync.syncSubjectAttendanceToDrive({
                subjectId: selectedSubjectId,
                cohortId: selectedCohortId,
                subjectName: subObj?.name || selectedSubjectId,
                date: selectedDate,
                month: selectedMonth,
              });
            }
          } catch (autoErr) {
            console.warn('[Mobile Attendance Auto-Drive] Background sync deferred:', autoErr);
          } finally {
            refreshDriveBackupState({ preserveMessages: true });
          }
        })();
      }
    } catch (err: any) {
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
            style={[
              styles.backBtn,
              { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <Text variant="lg" weight="700" style={{ color: colors.text, marginLeft: 10 }}>
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

  const activeDateAd = selectedDate || currentNepalDate;
  const activeDateBs = adToBs(activeDateAd);
  const todayBs = adToBs(currentNepalDate);
  const activeCohort = eligibleCohorts.find((c) => c.id === selectedCohortId) || eligibleCohorts[0] || null;
  const safeIndex = Math.min(Math.max(0, currentStudentIndex), Math.max(0, roster.length - 1));
  const currentStudent = roster[safeIndex] || null;
  const currentStudentStatus = currentStudent
    ? marksByStudentId[currentStudent.studentId] || null
    : null;
  const progressRatio = counts.total > 0 ? counts.marked / counts.total : 0;
  const shouldShowSavedScreen = Boolean(
    !isRosterLoading && existingSession && !isEditingExisting && activeTab === 'students'
  );

  const backupNeedsAttention =
    appRole === 'teacher' &&
    backupUiModel.visible &&
    !backupUiModel.isNotConfigured &&
    (backupUiModel.isReconnectRequired ||
      backupUiModel.failedCount > 0 ||
      backupUiModel.actionableCount > 0);

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      {/* Top Header Bar */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => {
            if (selectedSubject) {
              handleBackToSubjects();
            } else {
              confirmNavigationWithUnsavedGuard(() => {
                if (onClose) onClose();
                else router.back();
              });
            }
          }}
          style={[
            styles.backBtn,
            { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
          ]}
          accessibilityRole="button"
          accessibilityLabel={selectedSubject ? 'Back to subjects' : 'Back'}
        >
          <Ionicons name="arrow-back" size={18} color={colors.text} />
        </TouchableOpacity>

        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text
            variant="lg"
            weight="800"
            style={{ color: colors.text, letterSpacing: -0.3 }}
            numberOfLines={1}
          >
            {selectedSubject ? selectedSubject.name : 'Classroom Attendance'}
          </Text>
          <Text variant="xs" color="secondary" numberOfLines={1}>
            {selectedSubject
              ? `[${selectedSubject.code}] • Sem ${selectedSubject.semester}${
                  activeCohort ? ` • ${activeCohort.displayName}` : ''
                }`
              : todayBs
              ? `${todayBs.dateStr} BS • ${todayBs.formattedEn}`
              : 'Select a subject to take attendance'}
          </Text>
        </View>

        {appRole === 'teacher' && backupUiModel.visible && (
          <TouchableOpacity
            onPress={() => setBackupModalOpen(true)}
            style={[
              styles.headerIconBtn,
              { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Attendance Backup"
          >
            <Ionicons
              name={backupUiModel.isConnected ? 'cloud-done-outline' : 'cloud-upload-outline'}
              size={18}
              color={colors.text}
            />
            {backupNeedsAttention && <View style={styles.attentionDot} />}
          </TouchableOpacity>
        )}
      </View>

      {isContextLoading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="small" color={colors.text} />
          <Text variant="sm" color="secondary" style={{ marginTop: 10 }}>
            Loading your subjects…
          </Text>
        </View>
      ) : contextError ? (
        <View style={{ padding: 20 }}>
          <EmptyState
            icon="alert-circle-outline"
            title="Could Not Load Attendance Context"
            description={
              (contextError as any)?.message || 'Please check your connection and try again.'
            }
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
      ) : !selectedSubject ? (
        /* STEP 1: SUBJECT SELECTION LANDING SCREEN */
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            padding: 16,
            paddingBottom: Math.max(40, insets.bottom + 24),
          }}
        >
          <View style={styles.landingIntro}>
            <Text variant="xs" weight="700" color="secondary" style={styles.sectionLabel}>
              YOUR SUBJECTS ({subjects.length})
            </Text>
            <Text variant="xs" color="secondary">
              Tap a subject to mark attendance
            </Text>
          </View>

          <View style={{ gap: 10 }}>
            {subjects.map((sub) => {
              const subCohorts = Array.isArray(sub.cohorts)
                ? sub.cohorts
                : (contextData?.cohorts || []).filter(
                    (c) => Number(c.currentSemester) === Number(sub.semester)
                  );
              const cohortSummary =
                subCohorts.length > 0
                  ? subCohorts.map((c) => c.displayName).join(', ')
                  : 'No active cohort';

              return (
                <TouchableOpacity
                  key={sub.id}
                  activeOpacity={0.75}
                  onPress={() => {
                    setSelectedSubjectId(sub.id);
                    setActiveTab('students');
                    setCurrentStudentIndex(0);
                    setIsEditingExisting(false);
                    setSaveError(null);
                    setSaveSuccessMessage(null);
                  }}
                  style={[
                    styles.subjectCard,
                    {
                      backgroundColor: colors.surfaceRaised,
                      borderColor: colors.border,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Open attendance for ${sub.name}`}
                >
                  <View style={styles.subjectCardTop}>
                    <View style={styles.subjectMetaPills}>
                      <View
                        style={[
                          styles.codePill,
                          {
                            backgroundColor: colors.surfaceSubtle,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <Text variant="xs" weight="800" style={{ color: colors.text }}>
                          {sub.code}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.semPill,
                          {
                            backgroundColor: colors.surfaceSubtle,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <Text variant="xs" weight="600" color="secondary">
                          Sem {sub.semester}
                        </Text>
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                  </View>

                  <Text
                    variant="md"
                    weight="800"
                    style={{ color: colors.text, marginTop: 10, lineHeight: 22 }}
                  >
                    {sub.name}
                  </Text>

                  <View style={styles.subjectCardFooter}>
                    <Ionicons
                      name="people-outline"
                      size={13}
                      color={colors.textSecondary}
                      style={{ marginRight: 5 }}
                    />
                    <Text variant="xs" color="secondary" numberOfLines={1}>
                      {cohortSummary}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      ) : shouldShowSavedScreen ? (
        /* STEP 3: ATTENDANCE SAVED PAGE WITH DONE & EDIT ATTENDANCE BUTTONS */
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            flexGrow: 1,
            padding: 20,
            paddingBottom: Math.max(40, insets.bottom + 24),
            justifyContent: 'center',
          }}
        >
          <Card variant="elevated" style={[styles.savedCard, { borderColor: colors.border }]}>
            <View style={styles.savedIconCircle}>
              <Ionicons name="checkmark" size={34} color="#86efac" />
            </View>

            <Text
              variant="xl"
              weight="800"
              style={{ color: colors.text, textAlign: 'center', marginTop: 16 }}
            >
              Attendance Saved
            </Text>

            <Text
              variant="sm"
              color="secondary"
              style={{ textAlign: 'center', marginTop: 6 }}
            >
              [{selectedSubject.code}] {selectedSubject.name}
            </Text>

            <Text
              variant="xs"
              color="secondary"
              style={{ textAlign: 'center', marginTop: 4 }}
            >
              {formatBsDate(activeDateAd)}
              {activeDateBs ? ` • ${activeDateBs.formattedEn} BS` : ''}
              {activeCohort ? ` • ${activeCohort.displayName}` : ''}
            </Text>

            <View style={styles.savedStatsRow}>
              <View style={[styles.statPillBox, { backgroundColor: colors.surfaceSubtle }]}>
                <Text variant="md" weight="800" style={{ color: colors.text }}>
                  {counts.total}
                </Text>
                <Text variant="xs" color="secondary">
                  Total
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
                <Text variant="md" weight="800" style={{ color: colors.text }}>
                  {counts.attendancePercentage}%
                </Text>
                <Text variant="xs" color="secondary">
                  Rate
                </Text>
              </View>
            </View>

            {existingSession && (
              <View style={{ marginTop: 14, alignItems: 'center' }}>
                <Badge label={editWindowInfo.label} variant="neutral" size="sm" />
              </View>
            )}

            <View style={styles.savedActionsCol}>
              <TouchableOpacity
                onPress={handleBackToSubjects}
                style={[styles.submitBtn, { backgroundColor: colors.text }]}
                accessibilityRole="button"
                accessibilityLabel="Done"
              >
                <Text variant="sm" weight="800" style={{ color: colors.background }}>
                  Done
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setIsEditingExisting(true);
                  setActiveTab('students');
                  setCurrentStudentIndex(0);
                  setSaveError(null);
                  setSaveSuccessMessage(null);
                }}
                style={[
                  styles.secondaryFullBtn,
                  { backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
                ]}
                accessibilityRole="button"
                accessibilityLabel={isReadOnly ? 'View Attendance' : 'Edit Attendance'}
              >
                <Ionicons
                  name={isReadOnly ? 'list-outline' : 'create-outline'}
                  size={16}
                  color={colors.text}
                  style={{ marginRight: 6 }}
                />
                <Text variant="sm" weight="700" style={{ color: colors.text }}>
                  {isReadOnly ? 'View Attendance' : 'Edit Attendance'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setActiveTab('history');
                  refetchHistory();
                }}
                style={{ paddingVertical: 8, alignItems: 'center' }}
                accessibilityRole="button"
                accessibilityLabel="View History or Change Date"
              >
                <Text variant="xs" weight="600" color="secondary">
                  View History / Change Date
                </Text>
              </TouchableOpacity>
            </View>
          </Card>
        </ScrollView>
      ) : (
        /* STEP 2: SUBJECT ATTENDANCE SCREEN (BS DATE + FOCUSED STUDENT CARD) */
        <View style={{ flex: 1 }}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              padding: 16,
              paddingBottom: Math.max(40, insets.bottom + 24),
            }}
          >
            {/* BS Date Bar & Optional Multi-Cohort Switcher */}
            <Card variant="elevated" style={[styles.controlCard, { borderColor: colors.border }]}>
              <View style={styles.dateHeaderRow}>
                <Text variant="xs" weight="700" color="secondary" style={styles.sectionLabel}>
                  DATE (BS)
                </Text>
                {activeDateBs && (
                  <Text variant="xs" color="secondary">
                    {activeDateBs.formattedEn} BS
                  </Text>
                )}
              </View>

              <View style={styles.dateRow}>
                <TouchableOpacity
                  onPress={() =>
                    confirmNavigationWithUnsavedGuard(() => {
                      setSelectedDate((d) => stepNepalDate(d || currentNepalDate, -1));
                      setIsEditingExisting(false);
                      setSaveError(null);
                      setSaveSuccessMessage(null);
                    })
                  }
                  style={[
                    styles.dateStepBtn,
                    { backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
                  ]}
                  accessibilityLabel="Previous day"
                >
                  <Ionicons name="chevron-back" size={16} color={colors.text} />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setCustomDateInput(activeDateBs ? activeDateBs.dateStr : '');
                    setCustomDateModalOpen(true);
                  }}
                  style={[
                    styles.dateDisplayBox,
                    { backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Change session date in BS"
                >
                  <Ionicons
                    name="calendar-outline"
                    size={15}
                    color={colors.textSecondary}
                    style={{ marginRight: 6 }}
                  />
                  <Text variant="sm" weight="800" style={{ color: colors.text }}>
                    {formatBsDate(activeDateAd)}
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
                      setIsEditingExisting(false);
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

              {/* Show Cohort pills only if there are 0 or 2+ cohorts */}
              {eligibleCohorts.length === 0 ? (
                <View style={[styles.warningBox, { borderColor: colors.border, marginTop: 12 }]}>
                  <Text variant="xs" color="secondary">
                    No active student cohort is currently enrolled in Semester{' '}
                    {selectedSubject.semester}.
                  </Text>
                </View>
              ) : eligibleCohorts.length > 1 ? (
                <View style={{ marginTop: 12 }}>
                  <Text variant="xs" weight="700" color="secondary" style={styles.sectionLabel}>
                    COHORT
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {eligibleCohorts.map((c) => {
                      const isSelected = c.id === selectedCohortId;
                      return (
                        <TouchableOpacity
                          key={c.id}
                          onPress={() => {
                            if (c.id === selectedCohortId) return;
                            confirmNavigationWithUnsavedGuard(() => {
                              setSelectedCohortId(c.id);
                              setIsEditingExisting(false);
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
                </View>
              ) : null}
            </Card>

            {/* 2-Tab Switch: Mark | History */}
            <View style={styles.stageTabsRow}>
              <TouchableOpacity
                onPress={() => setActiveTab('students')}
                style={[
                  styles.stageTabBtn,
                  {
                    backgroundColor: activeTab === 'students' ? colors.text : colors.surfaceRaised,
                    borderColor: activeTab === 'students' ? colors.text : colors.border,
                  },
                ]}
              >
                <Text
                  variant="xs"
                  weight="700"
                  style={{
                    color: activeTab === 'students' ? colors.background : colors.textSecondary,
                  }}
                >
                  Mark ({counts.marked}/{counts.total})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setActiveTab('history');
                  refetchHistory();
                }}
                style={[
                  styles.stageTabBtn,
                  {
                    backgroundColor: activeTab === 'history' ? colors.text : colors.surfaceRaised,
                    borderColor: activeTab === 'history' ? colors.text : colors.border,
                  },
                ]}
              >
                <Text
                  variant="xs"
                  weight="700"
                  style={{
                    color: activeTab === 'history' ? colors.background : colors.textSecondary,
                  }}
                >
                  History ({historyData?.sessions?.length || 0})
                </Text>
              </TouchableOpacity>
            </View>

            {saveError && (
              <View style={[styles.statusBanner, styles.errorBanner]}>
                <Text variant="xs" weight="700" style={{ color: '#fca5a5' }}>
                  {saveError}
                </Text>
              </View>
            )}

            {/* Main Content */}
            {activeTab === 'history' ? (
              <View>
                {/* History Sub-Toggle: By Days | By Students */}
                <View style={styles.historyModeRow}>
                  <TouchableOpacity
                    onPress={() => setHistoryMode('days')}
                    style={[
                      styles.historyModeBtn,
                      {
                        backgroundColor:
                          historyMode === 'days' ? colors.surfaceSubtle : 'transparent',
                        borderColor: historyMode === 'days' ? colors.text : colors.border,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="View history by days"
                  >
                    <Ionicons
                      name="calendar-outline"
                      size={14}
                      color={historyMode === 'days' ? colors.text : colors.textSecondary}
                      style={{ marginRight: 6 }}
                    />
                    <Text
                      variant="xs"
                      weight="700"
                      style={{ color: historyMode === 'days' ? colors.text : colors.textSecondary }}
                    >
                      By Days
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => {
                      setHistoryMode('students');
                      if (selectedCohortId) refetchStudentSummary();
                    }}
                    style={[
                      styles.historyModeBtn,
                      {
                        backgroundColor:
                          historyMode === 'students' ? colors.surfaceSubtle : 'transparent',
                        borderColor: historyMode === 'students' ? colors.text : colors.border,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="View history by students"
                  >
                    <Ionicons
                      name="people-outline"
                      size={14}
                      color={historyMode === 'students' ? colors.text : colors.textSecondary}
                      style={{ marginRight: 6 }}
                    />
                    <Text
                      variant="xs"
                      weight="700"
                      style={{
                        color: historyMode === 'students' ? colors.text : colors.textSecondary,
                      }}
                    >
                      By Students
                    </Text>
                  </TouchableOpacity>
                </View>

                {historyMode === 'days' ? (
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
                      description="Submitted attendance sessions for this subject will appear here."
                    />
                  ) : (
                    <View>
                      <View style={styles.studentSummaryHeader}>
                        <Text variant="xs" weight="700" color="secondary">
                          {historyData.sessions.length} Day
                          {historyData.sessions.length === 1 ? '' : 's'}
                        </Text>
                        <Text variant="xs" color="secondary">
                          Tap a day to view
                        </Text>
                      </View>

                      <View style={{ gap: 8 }}>
                        {historyData.sessions.map((sess) => {
                          const c = sess.counts || {
                            total: 0,
                            present: 0,
                            absent: 0,
                            attendancePercentage: 0,
                          };
                          const sessBs = adToBs(sess.sessionDate);
                          const pct = c.attendancePercentage || 0;
                          const ratio = c.total > 0 ? Math.min(1, c.present / c.total) : 0;

                          return (
                            <TouchableOpacity
                              key={sess.id}
                              activeOpacity={0.75}
                              onPress={() =>
                                confirmNavigationWithUnsavedGuard(() => {
                                  if (sess.cohortId) setSelectedCohortId(sess.cohortId);
                                  setSelectedDate(sess.sessionDate);
                                  setIsEditingExisting(true);
                                  setActiveTab('students');
                                })
                              }
                              accessibilityRole="button"
                              accessibilityLabel={`Open attendance for ${formatBsDate(sess.sessionDate)}`}
                            >
                              <Card
                                variant="elevated"
                                style={[styles.studentSummaryCard, { borderColor: colors.border }]}
                              >
                                <View style={styles.studentSummaryTop}>
                                  <View style={{ flex: 1, marginRight: 10 }}>
                                    <Text
                                      variant="sm"
                                      weight="700"
                                      style={{ color: colors.text }}
                                      numberOfLines={1}
                                    >
                                      {formatBsDate(sess.sessionDate)}
                                    </Text>
                                    <Text variant="xs" color="secondary" style={{ marginTop: 2 }}>
                                      {sessBs ? `${sessBs.formattedEn} BS` : sess.sessionDate}
                                    </Text>
                                  </View>

                                  <View style={{ alignItems: 'flex-end' }}>
                                    <Text
                                      variant="md"
                                      weight="800"
                                      style={{
                                        color:
                                          c.total === 0
                                            ? colors.textSecondary
                                            : pct >= 75
                                            ? '#86efac'
                                            : pct >= 50
                                            ? colors.text
                                            : '#fca5a5',
                                      }}
                                    >
                                      {pct}%
                                    </Text>
                                    <Text variant="xs" color="secondary" style={{ marginTop: 1 }}>
                                      {c.present} / {c.total} present
                                    </Text>
                                  </View>
                                </View>

                                <View
                                  style={[
                                    styles.studentProgressTrack,
                                    { backgroundColor: colors.surfaceSubtle },
                                  ]}
                                >
                                  <View
                                    style={[
                                      styles.studentProgressFill,
                                      {
                                        width: `${Math.round(ratio * 100)}%`,
                                        backgroundColor:
                                          c.total === 0
                                            ? colors.border
                                            : pct >= 75
                                            ? '#86efac'
                                            : pct >= 50
                                            ? colors.text
                                            : '#ef4444',
                                      },
                                    ]}
                                  />
                                </View>
                              </Card>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  )
                ) : !selectedCohortId ? (
                  <EmptyState
                    icon="people-outline"
                    title="No Active Cohort"
                    description="Select an active cohort to view per-student attendance."
                  />
                ) : isStudentSummaryLoading ? (
                  <View style={styles.centerBox}>
                    <ActivityIndicator size="small" color={colors.text} />
                    <Text variant="xs" color="secondary" style={{ marginTop: 8 }}>
                      Loading student attendance…
                    </Text>
                  </View>
                ) : studentSummaryError ? (
                  <EmptyState
                    icon="alert-circle-outline"
                    title="Could Not Load Student Summary"
                    description={
                      (studentSummaryError as any)?.message ||
                      'Failed to load per-student attendance.'
                    }
                    actionTitle="Retry"
                    onAction={() => refetchStudentSummary()}
                  />
                ) : studentSummaries.length === 0 ? (
                  <EmptyState
                    icon="people-outline"
                    title="No Student Records Yet"
                    description="Student attendance percentages will appear once classes are recorded."
                  />
                ) : (
                  <View>
                    <View style={styles.studentSummaryHeader}>
                      <Text variant="xs" weight="700" color="secondary">
                        {studentSummaries.length} Students
                      </Text>
                      <Text variant="xs" weight="700" color="secondary">
                        Total Classes: {studentSummaries[0]?.overallTotalSessions ?? 0}
                      </Text>
                    </View>

                    <View style={{ gap: 8 }}>
                      {studentSummaries.map((stu, idx) => {
                        const totalCls = stu.overallTotalSessions || 0;
                        const presentCls = stu.overallPresentCount || 0;
                        const pct = stu.overallAttendancePercentage || 0;
                        const pctDisplay = stu.overallFormattedPercentage || '0.0%';
                        const ratio = totalCls > 0 ? Math.min(1, presentCls / totalCls) : 0;

                        return (
                          <Card
                            key={stu.studentId}
                            variant="elevated"
                            style={[styles.studentSummaryCard, { borderColor: colors.border }]}
                          >
                            <View style={styles.studentSummaryTop}>
                              <View style={{ flex: 1, marginRight: 10 }}>
                                <Text
                                  variant="sm"
                                  weight="700"
                                  style={{ color: colors.text }}
                                  numberOfLines={1}
                                >
                                  {idx + 1}. {stu.name}
                                </Text>
                                <Text variant="xs" color="secondary" style={{ marginTop: 2 }}>
                                  {stu.studentId}
                                  {stu.role === 'cr' ? ' • CR' : ''}
                                </Text>
                              </View>

                              <View style={{ alignItems: 'flex-end' }}>
                                <Text
                                  variant="md"
                                  weight="800"
                                  style={{
                                    color:
                                      totalCls === 0
                                        ? colors.textSecondary
                                        : pct >= 75
                                        ? '#86efac'
                                        : pct >= 50
                                        ? colors.text
                                        : '#fca5a5',
                                  }}
                                >
                                  {pctDisplay}
                                </Text>
                                <Text variant="xs" color="secondary" style={{ marginTop: 1 }}>
                                  {presentCls} / {totalCls} classes
                                </Text>
                              </View>
                            </View>

                            <View
                              style={[
                                styles.studentProgressTrack,
                                { backgroundColor: colors.surfaceSubtle },
                              ]}
                            >
                              <View
                                style={[
                                  styles.studentProgressFill,
                                  {
                                    width: `${Math.round(ratio * 100)}%`,
                                    backgroundColor:
                                      totalCls === 0
                                        ? colors.border
                                        : pct >= 75
                                        ? '#86efac'
                                        : pct >= 50
                                        ? colors.text
                                        : '#ef4444',
                                  },
                                ]}
                              />
                            </View>
                          </Card>
                        );
                      })}
                    </View>
                  </View>
                )}
              </View>
            ) : !selectedCohortId ? null : isRosterLoading ? (
              <View style={styles.centerBox}>
                <ActivityIndicator size="small" color={colors.text} />
                <Text variant="sm" color="secondary" style={{ marginTop: 8 }}>
                  Loading students…
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
            ) : existingSession ? (
              /* SAVED SESSION LIST VIEW: EDITABLE BUTTONS (<=24h) OR TEXT-ONLY (>24h) */
              <View>
                <View style={styles.listSummaryRow}>
                  <Text variant="xs" weight="700" style={{ color: '#86efac' }}>
                    P: {counts.present}
                  </Text>
                  <Text variant="xs" color="secondary">
                    •
                  </Text>
                  <Text variant="xs" weight="700" style={{ color: '#fca5a5' }}>
                    A: {counts.absent}
                  </Text>
                </View>

                <View style={{ gap: 10 }}>
                  {roster.map((student, idx) => {
                    const status = marksByStudentId[student.studentId] || null;

                    return (
                      <View
                        key={student.studentId}
                        style={[
                          styles.studentRowCard,
                          {
                            backgroundColor: colors.surfaceRaised,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <View style={styles.studentRowLeft}>
                          <Text
                            variant="xs"
                            weight="700"
                            color="secondary"
                            style={styles.rollIndex}
                          >
                            {idx + 1}.
                          </Text>
                          <View style={{ flex: 1 }}>
                            <Text
                              variant="sm"
                              weight="700"
                              style={{ color: colors.text }}
                              numberOfLines={1}
                            >
                              {student.name}
                            </Text>
                            <Text variant="xs" color="secondary" style={{ marginTop: 2 }}>
                              {student.studentId}
                              {student.role === 'cr' ? ' • CR' : ''}
                            </Text>
                          </View>
                        </View>

                        {isReadOnly ? (
                          <Text
                            variant="sm"
                            weight="700"
                            style={{
                              color:
                                status === 'present'
                                  ? '#86efac'
                                  : status === 'absent'
                                  ? '#fca5a5'
                                  : colors.textSecondary,
                              marginLeft: 10,
                            }}
                          >
                            {status === 'present'
                              ? 'Present'
                              : status === 'absent'
                              ? 'Absent'
                              : 'Unmarked'}
                          </Text>
                        ) : (
                          <View style={styles.studentRowActions}>
                            <TouchableOpacity
                              disabled={isSaving}
                              onPress={() =>
                                handleSelectStatus(student.studentId, 'present', false)
                              }
                              style={[
                                styles.rowToggleBtn,
                                {
                                  backgroundColor:
                                    status === 'present' ? '#f5f5f5' : colors.surfaceSubtle,
                                  borderColor:
                                    status === 'present' ? '#f5f5f5' : colors.border,
                                },
                              ]}
                              accessibilityRole="button"
                              accessibilityLabel={`Mark ${student.name} Present`}
                              accessibilityState={{ selected: status === 'present' }}
                            >
                              <Ionicons
                                name="checkmark"
                                size={14}
                                color={status === 'present' ? '#0a0a0a' : colors.textSecondary}
                                style={{ marginRight: 4 }}
                              />
                              <Text
                                variant="xs"
                                weight="700"
                                style={{
                                  color: status === 'present' ? '#0a0a0a' : colors.textSecondary,
                                }}
                              >
                                Present
                              </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              disabled={isSaving}
                              onPress={() =>
                                handleSelectStatus(student.studentId, 'absent', false)
                              }
                              style={[
                                styles.rowToggleBtn,
                                {
                                  backgroundColor: colors.surfaceSubtle,
                                  borderColor: colors.border,
                                },
                              ]}
                              accessibilityRole="button"
                              accessibilityLabel={`Mark ${student.name} Absent`}
                              accessibilityState={{ selected: status === 'absent' }}
                            >
                              <Ionicons
                                name="close"
                                size={14}
                                color={status === 'absent' ? '#f87171' : colors.textSecondary}
                                style={{ marginRight: 4 }}
                              />
                              <Text
                                variant="xs"
                                weight="700"
                                style={{
                                  color: status === 'absent' ? '#f87171' : colors.textSecondary,
                                }}
                              >
                                Absent
                              </Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>

                {!isReadOnly && (
                  <View style={{ marginTop: 16 }}>
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
                      accessibilityLabel="Save Attendance Changes"
                    >
                      {isSaving ? (
                        <ActivityIndicator size="small" color={colors.background} />
                      ) : (
                        <Text variant="sm" weight="800" style={{ color: colors.background }}>
                          Save Attendance Changes
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ) : currentStudent ? (
              /* FOCUSED ONE-STUDENT-AT-A-TIME MARKING CARD (FIRST-TIME TAKING ATTENDANCE) */
              <View>
                <Card variant="elevated" style={[styles.focusCard, { borderColor: colors.border }]}>
                  <View style={styles.countsStrip}>
                    <Text variant="xs" weight="700" color="secondary">
                      Student {safeIndex + 1} of {counts.total}
                    </Text>
                    <Text variant="xs" weight="700" color="secondary">
                      Present: {counts.present} • Absent: {counts.absent} • Unmarked:{' '}
                      {counts.unmarked}
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

                  <View
                    style={[
                      styles.studentAvatarCircle,
                      { backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xl" weight="800" style={{ color: colors.text }}>
                      {(currentStudent.name || 'S').charAt(0).toUpperCase()}
                    </Text>
                  </View>

                  <Text
                    variant="xl"
                    weight="800"
                    style={{ color: colors.text, textAlign: 'center' }}
                  >
                    {currentStudent.name}
                  </Text>
                  <Text
                    variant="xs"
                    color="secondary"
                    style={{ textAlign: 'center', marginTop: 4, marginBottom: 20 }}
                  >
                    ID: {currentStudent.studentId}
                    {currentStudent.username ? ` • @${currentStudent.username}` : ''}
                    {currentStudent.role === 'cr' ? ' • CR' : ''}
                  </Text>

                  {/* Present / Absent Buttons */}
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
                          backgroundColor: colors.surfaceSubtle,
                          borderColor: colors.border,
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
                        color={currentStudentStatus === 'absent' ? '#f87171' : colors.text}
                        style={{ marginRight: 6 }}
                      />
                      <Text
                        variant="md"
                        weight="800"
                        style={{
                          color: currentStudentStatus === 'absent' ? '#f87171' : colors.text,
                        }}
                      >
                        Absent
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Previous / Next Navigation */}
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

                    <TouchableOpacity
                      disabled={safeIndex >= counts.total - 1}
                      onPress={() =>
                        setCurrentStudentIndex((i) => Math.min(counts.total - 1, i + 1))
                      }
                      style={[
                        styles.smallActionBtn,
                        {
                          backgroundColor: colors.surfaceSubtle,
                          borderColor: colors.border,
                          opacity: safeIndex >= counts.total - 1 ? 0.4 : 1,
                        },
                      ]}
                    >
                      <Text variant="xs" weight="700" style={{ color: colors.text }}>
                        Next →
                      </Text>
                    </TouchableOpacity>
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
                              alignItems: 'center',
                              backgroundColor:
                                st === 'present' ? '#f5f5f5' : colors.surfaceSubtle,
                              borderColor: isCur ? colors.text : colors.border,
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
                                  ? '#f87171'
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

                {/* Save Attendance Button */}
                {!isReadOnly && (
                  <View style={{ marginTop: 16 }}>
                    {counts.unmarked > 0 && (
                      <Text
                        variant="xs"
                        color="secondary"
                        style={{ textAlign: 'center', marginBottom: 8 }}
                      >
                        Mark remaining {counts.unmarked} student
                        {counts.unmarked === 1 ? '' : 's'} to save
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
                        existingSession ? 'Save Attendance Changes' : 'Save Attendance'
                      }
                    >
                      {isSaving ? (
                        <ActivityIndicator size="small" color={colors.background} />
                      ) : (
                        <Text variant="sm" weight="800" style={{ color: colors.background }}>
                          {existingSession ? 'Save Attendance Changes' : 'Save Attendance'}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ) : null}
          </ScrollView>
        </View>
      )}

      {/* Custom BS Date Input Modal */}
      <Modal
        visible={customDateModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCustomDateModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalBox,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text variant="md" weight="700" style={{ color: colors.text, marginBottom: 6 }}>
              Select Session Date (BS)
            </Text>
            <Text variant="xs" color="secondary" style={{ marginBottom: 12 }}>
              Today (BS): {formatBsDate(currentNepalDate)}
              {todayBs ? ` (${todayBs.formattedEn})` : ''}. Enter YYYY-MM-DD in BS.
            </Text>
            <TextInput
              value={customDateInput}
              onChangeText={setCustomDateInput}
              placeholder="2083-08-04"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
              style={[
                styles.modalInput,
                {
                  color: colors.text,
                  borderColor: colors.border,
                  backgroundColor: colors.surfaceSubtle,
                },
              ]}
            />
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'flex-end',
                gap: 10,
                marginTop: 16,
              }}
            >
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
                  if (!/^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(trimmed)) {
                    Alert.alert(
                      'Invalid BS Date Format',
                      'Please enter a valid Bikram Sambat date in YYYY-MM-DD format (e.g. 2083-08-04).'
                    );
                    return;
                  }
                  const convertedAd = bsToAd(trimmed);
                  if (!convertedAd) {
                    Alert.alert(
                      'Invalid BS Calendar Date',
                      `"${trimmed}" is not a valid Bikram Sambat date (supported range: 2070–2090 BS).`
                    );
                    return;
                  }
                  if (currentNepalDate && convertedAd > currentNepalDate) {
                    Alert.alert(
                      'Future Date Not Allowed',
                      `Cannot select a future date (${trimmed} BS). Today is ${formatBsDate(
                        currentNepalDate
                      )}.`
                    );
                    return;
                  }
                  setCustomDateModalOpen(false);
                  if (convertedAd !== selectedDate) {
                    confirmNavigationWithUnsavedGuard(() => {
                      setSelectedDate(convertedAd);
                      setIsEditingExisting(false);
                      setSaveError(null);
                      setSaveSuccessMessage(null);
                    });
                  }
                }}
                style={[
                  styles.smallActionBtn,
                  { backgroundColor: colors.text, borderColor: colors.text },
                ]}
              >
                <Text variant="xs" weight="700" style={{ color: colors.background }}>
                  Apply Date
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Google Drive Attendance Backup Modal */}
      <Modal
        visible={backupModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setBackupModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalBox,
              { backgroundColor: colors.surface, borderColor: colors.border, maxHeight: '80%' },
            ]}
          >
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.backupHeaderRow} testID="teacher-drive-backup-card">
                <View style={{ flex: 1, marginRight: 8 }}>
                  <View style={styles.backupTitleRow}>
                    <Ionicons
                      name="cloud-upload-outline"
                      size={16}
                      color={colors.text}
                      style={{ marginRight: 6 }}
                    />
                    <Text variant="md" weight="800" style={{ color: colors.text }}>
                      Attendance Backup
                    </Text>
                    <Badge
                      label={backupUiModel.badgeLabel}
                      variant={backupUiModel.badgeVariant}
                      size="sm"
                      style={{ marginLeft: 8 }}
                    />
                  </View>
                  <Text variant="xs" color="secondary" style={{ marginTop: 6, lineHeight: 17 }}>
                    {backupUiModel.descriptionText}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setBackupModalOpen(false)}>
                  <Ionicons name="close" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

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

              {backupUiModel.effectiveErrorMessage ? (
                <View style={[styles.backupNoticeBox, styles.errorBanner]}>
                  <Text variant="xs" weight="600" style={{ color: '#fca5a5' }}>
                    {backupUiModel.effectiveErrorMessage}
                  </Text>
                </View>
              ) : null}

              {backupUiModel.effectiveNoticeMessage ? (
                <View
                  style={[
                    styles.backupNoticeBox,
                    styles.successBanner,
                    { borderColor: colors.border, backgroundColor: colors.surfaceRaised },
                  ]}
                >
                  <Text variant="xs" weight="600" style={{ color: '#86efac' }}>
                    {backupUiModel.effectiveNoticeMessage}
                  </Text>
                </View>
              ) : null}

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
                      <Text variant="xs" weight="700" style={{ color: colors.text }}>
                        {run.subjectCode}
                        {run.cohortName ? ` • ${run.cohortName}` : ''} •{' '}
                        {formatBsDate(run.sessionDate)} (v{run.revisionNo})
                      </Text>
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
                                run.snapshotStatus === 'failed' ||
                                run.snapshotStatus === 'reconnect_required'
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

              {!backupUiModel.isNotConfigured && (
                <View style={styles.backupActionsRow}>
                  {backupUiModel.isBusy ? (
                    <View
                      style={[
                        styles.backupPrimaryBtn,
                        {
                          backgroundColor: colors.surfaceSubtle,
                          borderColor: colors.border,
                          opacity: 0.7,
                        },
                      ]}
                    >
                      <ActivityIndicator
                        size="small"
                        color={colors.text}
                        style={{ marginRight: 8 }}
                      />
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
                      style={[
                        styles.backupPrimaryBtn,
                        { backgroundColor: colors.text, borderColor: colors.text },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Connect Google Drive"
                      testID="btn-connect-drive-backup"
                    >
                      <Ionicons
                        name="logo-google"
                        size={14}
                        color={colors.background}
                        style={{ marginRight: 6 }}
                      />
                      <Text variant="xs" weight="800" style={{ color: colors.background }}>
                        Connect Google Drive
                      </Text>
                    </TouchableOpacity>
                  ) : backupUiModel.canReconnect ? (
                    <>
                      <TouchableOpacity
                        onPress={handleConnectDriveBackup}
                        style={[
                          styles.backupPrimaryBtn,
                          { backgroundColor: colors.text, borderColor: colors.text },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Reconnect Google Drive"
                        testID="btn-reconnect-drive-backup"
                      >
                        <Ionicons
                          name="refresh"
                          size={14}
                          color={colors.background}
                          style={{ marginRight: 6 }}
                        />
                        <Text variant="xs" weight="800" style={{ color: colors.background }}>
                          Reconnect Google Drive
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={handleDisconnectDriveBackup}
                        style={[
                          styles.backupSecondaryBtn,
                          {
                            backgroundColor: colors.surfaceSubtle,
                            borderColor: colors.border,
                          },
                        ]}
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
                        style={[
                          styles.backupPrimaryBtn,
                          { backgroundColor: colors.text, borderColor: colors.text },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={
                          backupUiModel.canRetry ? 'Retry Sync' : 'Sync Current Subject'
                        }
                        testID={
                          backupUiModel.canRetry
                            ? 'btn-retry-drive-backup'
                            : 'btn-sync-drive-backup'
                        }
                      >
                        <Ionicons
                          name={backupUiModel.canRetry ? 'refresh' : 'sync-outline'}
                          size={14}
                          color={colors.background}
                          style={{ marginRight: 6 }}
                        />
                        <Text variant="xs" weight="800" style={{ color: colors.background }}>
                          {backupUiModel.canRetry ? 'Retry Sync' : 'Sync Current Subject'}
                        </Text>
                      </TouchableOpacity>
                      {subjects.length > 1 && (
                        <TouchableOpacity
                          onPress={handleSyncAllSubjectsDriveBackup}
                          style={[
                            styles.backupPrimaryBtn,
                            { backgroundColor: '#10b981', borderColor: '#059669' },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel="Sync All Subjects to Drive"
                          testID="btn-sync-all-subjects-drive-backup"
                        >
                          <Ionicons
                            name="cloud-upload-outline"
                            size={14}
                            color="#fff"
                            style={{ marginRight: 6 }}
                          />
                          <Text variant="xs" weight="800" style={{ color: '#fff' }}>
                            Sync All {subjects.length} Subjects to Drive
                          </Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        onPress={handleDisconnectDriveBackup}
                        style={[
                          styles.backupSecondaryBtn,
                          {
                            backgroundColor: colors.surfaceSubtle,
                            borderColor: colors.border,
                          },
                        ]}
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
            </ScrollView>
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
          <View
            style={[
              styles.modalBox,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
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
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
    position: 'relative',
  },
  attentionDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#f59e0b',
  },
  centerBox: {
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  landingIntro: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  subjectCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  subjectCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  subjectMetaPills: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  codePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  semPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  subjectCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  controlCard: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    backgroundColor: '#121212',
  },
  dateHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionLabel: {
    letterSpacing: 0.5,
  },
  pillBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
  },
  warningBox: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
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
    marginBottom: 12,
  },
  stageTabBtn: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBanner: {
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  errorBanner: {
    borderColor: 'rgba(239, 68, 68, 0.5)',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  successBanner: {
    borderColor: '#262626',
    backgroundColor: '#121212',
  },
  listSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  studentRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  studentRowLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginRight: 10,
  },
  rollIndex: {
    width: 24,
    marginTop: 1,
  },
  studentRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 9,
    borderWidth: 1,
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
  savedCard: {
    borderRadius: 18,
    padding: 24,
    borderWidth: 1,
    backgroundColor: '#121212',
    alignItems: 'center',
  },
  savedIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1.5,
    borderColor: 'rgba(34, 197, 94, 0.55)',
    backgroundColor: 'rgba(34, 197, 94, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedStatsRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 8,
    marginTop: 20,
  },
  statPillBox: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  savedActionsCol: {
    width: '100%',
    gap: 10,
    marginTop: 22,
  },
  secondaryFullBtn: {
    width: '100%',
    height: 46,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallActionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  submitBtn: {
    width: '100%',
    height: 46,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
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
    marginTop: 14,
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
  historyModeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  historyModeBtn: {
    flex: 1,
    height: 36,
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyCard: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    backgroundColor: '#121212',
  },
  studentSummaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  studentSummaryCard: {
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    backgroundColor: '#121212',
  },
  studentSummaryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  studentProgressTrack: {
    width: '100%',
    height: 5,
    borderRadius: 999,
    overflow: 'hidden',
    marginTop: 10,
  },
  studentProgressFill: {
    height: '100%',
    borderRadius: 999,
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
