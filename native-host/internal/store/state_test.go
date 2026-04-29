package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func tempStoreDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := EnsureDirs(dir); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestEnsureDirs_CreatesStateAndActions(t *testing.T) {
	dir := t.TempDir()
	if err := EnsureDirs(dir); err != nil {
		t.Fatal(err)
	}
	for _, sub := range []string{"state", "actions", "logs"} {
		if _, err := os.Stat(filepath.Join(dir, sub)); err != nil {
			t.Errorf("expected %s to exist: %v", sub, err)
		}
	}
}

func TestWriteState_CreatesFileWithFreshHeartbeat(t *testing.T) {
	dir := tempStoreDir(t)
	p := Profile{
		SchemaVersion: 1,
		ProfileUuid:   "test-uuid-1",
		Label:         "Test",
		Tabs:          []Tab{},
	}

	before := time.Now().UnixMilli()
	if err := WriteState(dir, p); err != nil {
		t.Fatal(err)
	}
	after := time.Now().UnixMilli()

	data, err := os.ReadFile(filepath.Join(dir, "state", "test-uuid-1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var got Profile
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if got.HeartbeatUnixMs < before || got.HeartbeatUnixMs > after {
		t.Errorf("heartbeat %d not in [%d, %d]", got.HeartbeatUnixMs, before, after)
	}
	if got.Label != "Test" {
		t.Errorf("label = %q, want Test", got.Label)
	}
}

func TestWriteState_AtomicViaTempRename(t *testing.T) {
	dir := tempStoreDir(t)
	p := Profile{SchemaVersion: 1, ProfileUuid: "atomic-test", Label: "X"}
	if err := WriteState(dir, p); err != nil {
		t.Fatal(err)
	}
	// no .tmp leftover
	leftover := filepath.Join(dir, "state", "atomic-test.json.tmp")
	if _, err := os.Stat(leftover); !os.IsNotExist(err) {
		t.Errorf("expected no .tmp leftover, got %v", err)
	}
}

func TestReadAllStates_FiltersStale(t *testing.T) {
	dir := tempStoreDir(t)

	fresh := Profile{SchemaVersion: 1, ProfileUuid: "fresh", Label: "F"}
	stale := Profile{
		SchemaVersion:   1,
		ProfileUuid:     "stale",
		Label:           "S",
		HeartbeatUnixMs: time.Now().UnixMilli() - HeartbeatThresholdMs - 1000,
	}

	if err := WriteState(dir, fresh); err != nil {
		t.Fatal(err)
	}
	// write stale directly without going through WriteState (which refreshes heartbeat)
	data, _ := json.MarshalIndent(stale, "", "  ")
	staleFile := filepath.Join(dir, "state", "stale.json")
	os.WriteFile(staleFile, data, 0644)

	profiles, err := ReadAllStates(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(profiles) != 1 {
		t.Fatalf("expected 1 fresh profile, got %d", len(profiles))
	}
	if profiles[0].ProfileUuid != "fresh" {
		t.Errorf("got profile %q, want fresh", profiles[0].ProfileUuid)
	}
}

func TestReadAllStates_SkipsNonJsonAndUnreadable(t *testing.T) {
	dir := tempStoreDir(t)
	stateDir := filepath.Join(dir, "state")
	os.WriteFile(filepath.Join(stateDir, "not-json.txt"), []byte("hello"), 0644)
	os.WriteFile(filepath.Join(stateDir, "broken.json"), []byte("{not json"), 0644)

	good := Profile{SchemaVersion: 1, ProfileUuid: "good", Label: "G"}
	if err := WriteState(dir, good); err != nil {
		t.Fatal(err)
	}

	profiles, err := ReadAllStates(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(profiles) != 1 {
		t.Errorf("expected 1 valid profile, got %d", len(profiles))
	}
}
