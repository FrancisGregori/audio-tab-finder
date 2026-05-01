package watcher

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/store"
)

func TestStateWatcher_NotifiesOnFileChange(t *testing.T) {
	dir := t.TempDir()
	if err := store.EnsureDirs(dir); err != nil {
		t.Fatal(err)
	}

	var mu sync.Mutex
	count := 0
	w, err := NewStateWatcher(filepath.Join(dir, "state"), func() {
		mu.Lock()
		count++
		mu.Unlock()
	})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	p := store.Profile{SchemaVersion: 1, ProfileUuid: "test", Label: "X"}
	if err := store.WriteState(dir, p); err != nil {
		t.Fatal(err)
	}

	waitForCondition(t, 2*time.Second, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return count >= 1
	})
}

func TestStateWatcher_IgnoresNonJsonAndTmpFiles(t *testing.T) {
	dir := t.TempDir()
	if err := store.EnsureDirs(dir); err != nil {
		t.Fatal(err)
	}
	stateDir := filepath.Join(dir, "state")

	var mu sync.Mutex
	count := 0
	w, err := NewStateWatcher(stateDir, func() {
		mu.Lock()
		count++
		mu.Unlock()
	})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	os.WriteFile(filepath.Join(stateDir, "ignored.txt"), []byte("hello"), 0644)
	os.WriteFile(filepath.Join(stateDir, "incomplete.json.tmp"), []byte("{}"), 0644)

	time.Sleep(500 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if count != 0 {
		t.Errorf("expected 0 callbacks, got %d", count)
	}
}
