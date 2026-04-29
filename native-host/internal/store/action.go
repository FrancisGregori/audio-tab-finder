package store

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"
)

type Action struct {
	SchemaVersion     int    `json:"schema_version"`
	ActionId          string `json:"action_id"`
	SourceProfileUuid string `json:"source_profile_uuid"`
	TargetProfileUuid string `json:"target_profile_uuid"`
	Action            string `json:"action"`
	TargetTabId       int    `json:"target_tab_id"`
	TargetWindowId    int    `json:"target_window_id"`
	CreatedAtUnixMs   int64  `json:"created_at_unix_ms"`
	TtlMs             int64  `json:"ttl_ms"`
}

func (a Action) Expired() bool {
	return time.Now().UnixMilli() > a.CreatedAtUnixMs+a.TtlMs
}

func WriteAction(dir string, a Action) error {
	final := filepath.Join(dir, "actions", a.ActionId+".json")
	tmp := final + ".tmp"
	data, err := json.MarshalIndent(a, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, final)
}

func ReadAction(path string) (Action, error) {
	var a Action
	data, err := os.ReadFile(path)
	if err != nil {
		return a, err
	}
	if err := json.Unmarshal(data, &a); err != nil {
		return a, err
	}
	return a, nil
}

func DeleteActionFile(path string) error {
	err := os.Remove(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
