import React, { Component, ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { HideAndSeekScreen } from '@/components/games/hide-and-seek/HideAndSeekScreen';

interface ErrorBoundaryProps {
  children: ReactNode;
  onBack: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class GameErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.warn('HideAndSeek error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <Ionicons name="warning" size={48} color="#facc15" />
          <Text style={styles.errorTitle}>Nightfall Engine Notice</Text>
          <Text style={styles.errorSubtitle}>
            {this.state.error?.message || 'Unable to start 3D horror night session.'}
          </Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => this.setState({ hasError: false })}
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.backButton}
            onPress={this.props.onBack}
          >
            <Text style={styles.backText}>Return to Games</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function HideAndSeekPage() {
  const router = useRouter();

  React.useEffect(() => {
    console.log('[HideAndSeek] HideAndSeekPage route mounted successfully');
  }, []);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/games' as any);
    }
  };

  return (
    <View style={styles.pageContainer}>
      <GameErrorBoundary onBack={handleBack}>
        <HideAndSeekScreen onBack={handleBack} />
      </GameErrorBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  pageContainer: {
    flex: 1,
    backgroundColor: '#070b12',
    width: '100%',
    height: '100%',
  },
  errorContainer: {
    flex: 1,
    backgroundColor: '#050507',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorTitle: {
    color: '#fef08a',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 14,
    marginBottom: 8,
  },
  errorSubtitle: {
    color: '#a8a29e',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: '#eab308',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 14,
    marginBottom: 12,
  },
  retryText: {
    color: '#090806',
    fontWeight: '800',
    fontSize: 15,
  },
  backButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  backText: {
    color: '#fde047',
    fontWeight: '700',
    fontSize: 14,
  },
});
