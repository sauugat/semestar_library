import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 45 * 1000,
      gcTime: 1000 * 60 * 60 * 24, // 24 hours
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'SEMESTER_LIBRARY_QUERY_CACHE',
});

export async function clearAppQueryCache(): Promise<void> {
  try {
    queryClient.clear();
    await AsyncStorage.removeItem('SEMESTER_LIBRARY_QUERY_CACHE');
  } catch (err) {
    console.warn('Failed to clear persisted query cache:', err);
  }
}
