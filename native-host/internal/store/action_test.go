package store

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWriteAction_CreatesFile(t *testing.T) {
	dir := tempStoreDir(t)
	a := Action{
		SchemaVersion:     1,
		ActionId:          "act-1",
		SourceProfileUuid: "src",
		TargetProfileUuid: "tgt",
		Action:            "mute",
		TargetTabId:       42,
		TargetWindowId:    7,
		CreatedAtUnixMs:   time.Now().UnixMilli(),
		TtlMs:             5000,
	}
	if err := WriteAction(dir, a); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "actions", "act-1.json")); err != nil {
		t.Errorf("expected action file, got %v", err)
	}
}

func TestReadAction_ReadsBackWhatWasWritten(t *testing.T) {
	dir := tempStoreDir(t)
	a := Action{
		SchemaVersion:     1,
		ActionId:          "round-trip",
		SourceProfileUuid: "src",
		TargetProfileUuid: "tgt",
		Action:            "close",
		TargetTabId:       99,
		TargetWindowId:    3,
		CreatedAtUnixMs:   time.Now().UnixMilli(),
		TtlMs:             5000,
	}
	if err := WriteAction(dir, a); err != nil {
		t.Fatal(err)
	}
	got, err := ReadAction(filepath.Join(dir, "actions", "round-trip.json"))
	if err != nil {
		t.Fatal(err)
	}
	if got.ActionId != "round-trip" || got.Action != "close" || got.TargetTabId != 99 {
		t.Errorf("read mismatch: %+v", got)
	}
}

func TestAction_Expired(t *testing.T) {
	notExpired := Action{
		CreatedAtUnixMs: time.Now().UnixMilli() - 1000,
		TtlMs:           5000,
	}
	expired := Action{
		CreatedAtUnixMs: time.Now().UnixMilli() - 10_000,
		TtlMs:           5000,
	}
	if notExpired.Expired() {
		t.Error("expected not expired")
	}
	if !expired.Expired() {
		t.Error("expected expired")
	}
}

func TestDeleteAction(t *testing.T) {
	dir := tempStoreDir(t)
	a := Action{
		SchemaVersion: 1, ActionId: "del-test",
		SourceProfileUuid: "s", TargetProfileUuid: "t",
		Action: "mute", CreatedAtUnixMs: time.Now().UnixMilli(), TtlMs: 5000,
	}
	if err := WriteAction(dir, a); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "actions", "del-test.json")
	if err := DeleteActionFile(path); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("expected file gone, got %v", err)
	}
}

func TestDeleteAction_IdempotentOnMissingFile(t *testing.T) {
	dir := tempStoreDir(t)
	path := filepath.Join(dir, "actions", "never-existed.json")
	if err := DeleteActionFile(path); err != nil {
		t.Errorf("expected nil error on missing file, got %v", err)
	}
}
