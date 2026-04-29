package watcher

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/store"
)

func TestWatcher_DeliversActionsForOwnUuid(t *testing.T) {
	dir := t.TempDir()
	if err := store.EnsureDirs(dir); err != nil {
		t.Fatal(err)
	}

	var mu sync.Mutex
	var received []store.Action

	w, err := New(filepath.Join(dir, "actions"), "my-uuid", func(a store.Action) {
		mu.Lock()
		defer mu.Unlock()
		received = append(received, a)
	})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	a := store.Action{
		SchemaVersion: 1, ActionId: "for-me",
		SourceProfileUuid: "other", TargetProfileUuid: "my-uuid",
		Action: "mute", TargetTabId: 1, TargetWindowId: 2,
		CreatedAtUnixMs: time.Now().UnixMilli(), TtlMs: 5000,
	}
	if err := store.WriteAction(dir, a); err != nil {
		t.Fatal(err)
	}

	waitForCondition(t, 2*time.Second, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(received) == 1
	})

	mu.Lock()
	defer mu.Unlock()
	if received[0].ActionId != "for-me" {
		t.Errorf("got %q want for-me", received[0].ActionId)
	}
}

func TestWatcher_IgnoresActionsForOtherUuid(t *testing.T) {
	dir := t.TempDir()
	store.EnsureDirs(dir)

	var mu sync.Mutex
	var received []store.Action

	w, err := New(filepath.Join(dir, "actions"), "my-uuid", func(a store.Action) {
		mu.Lock()
		defer mu.Unlock()
		received = append(received, a)
	})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	a := store.Action{
		SchemaVersion: 1, ActionId: "not-for-me",
		SourceProfileUuid: "other", TargetProfileUuid: "someone-else",
		Action: "mute", TargetTabId: 1,
		CreatedAtUnixMs: time.Now().UnixMilli(), TtlMs: 5000,
	}
	store.WriteAction(dir, a)

	time.Sleep(500 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 0 {
		t.Errorf("expected 0 received, got %d", len(received))
	}
}

func TestWatcher_GarbageCollectsExpiredActions(t *testing.T) {
	dir := t.TempDir()
	store.EnsureDirs(dir)

	w, err := New(filepath.Join(dir, "actions"), "my-uuid", func(a store.Action) {
		t.Errorf("callback should not fire for expired action")
	})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	expired := store.Action{
		SchemaVersion: 1, ActionId: "expired",
		SourceProfileUuid: "other", TargetProfileUuid: "my-uuid",
		Action: "mute",
		CreatedAtUnixMs: time.Now().UnixMilli() - 10_000,
		TtlMs:           5000,
	}
	store.WriteAction(dir, expired)

	path := filepath.Join(dir, "actions", "expired.json")
	waitForCondition(t, 2*time.Second, func() bool {
		_, err := os.Stat(path)
		return os.IsNotExist(err)
	})
}

func waitForCondition(t *testing.T, timeout time.Duration, fn func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if fn() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("condition not met within %v", timeout)
}
