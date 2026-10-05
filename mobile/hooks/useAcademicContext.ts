import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { fetchAcademicContext, AcademicContextResponse } from '@/services/academicContext';

export function useAcademicContext() {
  const { user, token } = useAuth();

  const query = useQuery<AcademicContextResponse>({
    queryKey: ['academic-context', user?.studentId],
    queryFn: fetchAcademicContext,
    enabled: !!token,
    staleTime: 60 * 1000, // 1 minute fresh cache
  });

  return {
    ...query,
    academicContext: query.data,
    cohort: query.data?.cohort || null,
    displayLabel: query.data?.displayLabel || null,
    isUnassigned: query.data?.academicStatus === 'unassigned',
    isStaff: query.data?.role === 'teacher' || query.data?.role === 'admin',
    semesterRoman: query.data?.semesterRoman || null,
    currentSemesterNumber: query.data?.cohort?.currentSemester || null,
  };
}
