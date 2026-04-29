package logging

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"gopkg.in/natefinch/lumberjack.v2"
)

type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelWarn
	LevelError
	LevelFatal
)

func (l Level) String() string {
	switch l {
	case LevelDebug:
		return "DEBUG"
	case LevelInfo:
		return "INFO"
	case LevelWarn:
		return "WARN"
	case LevelError:
		return "ERROR"
	case LevelFatal:
		return "FATAL"
	}
	return "UNKNOWN"
}

type Logger struct {
	out   io.Writer
	level Level
	mu    sync.RWMutex
	inner *log.Logger
}

func New(logDir string) (*Logger, error) {
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return nil, fmt.Errorf("create log dir: %w", err)
	}
	rot := &lumberjack.Logger{
		Filename:   filepath.Join(logDir, "host.log"),
		MaxSize:    1, // 1 MB
		MaxBackups: 3,
		MaxAge:     30, // days
		Compress:   false,
	}
	return &Logger{
		out:   rot,
		level: LevelInfo,
		inner: log.New(rot, "", 0),
	}, nil
}

func (l *Logger) SetLevel(lvl Level) {
	l.mu.Lock()
	l.level = lvl
	l.mu.Unlock()
}

func (l *Logger) log(lvl Level, args ...any) {
	l.mu.RLock()
	skip := lvl < l.level
	l.mu.RUnlock()
	if skip {
		return
	}
	prefix := fmt.Sprintf("%s [%s] ", time.Now().Format(time.RFC3339), lvl)
	l.inner.Println(prefix + fmt.Sprint(args...))
}

func (l *Logger) Debug(args ...any) { l.log(LevelDebug, args...) }
func (l *Logger) Info(args ...any)  { l.log(LevelInfo, args...) }
func (l *Logger) Warn(args ...any)  { l.log(LevelWarn, args...) }
func (l *Logger) Error(args ...any) { l.log(LevelError, args...) }
func (l *Logger) Fatal(args ...any) {
	l.log(LevelFatal, args...)
	os.Exit(1)
}

func (l *Logger) Close() error {
	if c, ok := l.out.(io.Closer); ok {
		return c.Close()
	}
	return nil
}
