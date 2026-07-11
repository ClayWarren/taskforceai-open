package pkg

import (
	"log"
	"testing"

	"github.com/stretchr/testify/mock"
)

func TestRedirectStdLog(t *testing.T) {
	mockT := new(MockTransport)
	logger := NewLogger(LoggerOptions{
		Level:      LevelInfo,
		Transports: []LogTransport{mockT},
	})

	mockT.On("Log", mock.MatchedBy(func(e LogEntry) bool {
		return e.Message == "std log message"
	})).Return(nil)

	logger.RedirectStdLog(LevelInfo)
	log.Print("std log message")
	RestoreStdLog()

	mockT.AssertExpectations(t)
}

func TestRestoreStdLog_AllowsSubsequentStdLogging(t *testing.T) {
	previousWriter := log.Writer()
	previousFlags := log.Flags()
	t.Cleanup(func() {
		log.SetOutput(previousWriter)
		log.SetFlags(previousFlags)
	})

	mockT := new(MockTransport)
	logger := NewLogger(LoggerOptions{
		Level:      LevelInfo,
		Transports: []LogTransport{mockT},
	})

	logger.RedirectStdLog(LevelInfo)
	RestoreStdLog()

	if log.Writer() == nil {
		t.Fatal("expected std log writer to be non-nil after restore")
	}
	if got := log.Flags(); got != log.LstdFlags {
		t.Fatalf("expected std log flags %d, got %d", log.LstdFlags, got)
	}

	log.Print("logging after restore should not panic")
}
