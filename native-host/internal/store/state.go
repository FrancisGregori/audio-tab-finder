package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const HeartbeatThresholdMs = 60_000

type Tab struct {
	TabId      int    `json:"tab_id"`
	WindowId   int    `json:"window_id"`
	Title      string `json:"title"`
	Url        string `json:"url"`
	FaviconUrl string `json:"favicon_url"`
	Muted      bool   `json:"muted"`
}

type Profile struct {
	SchemaVersion   int    `json:"schema_version"`
	ProfileUuid     string `json:"profile_uuid"`
	Label           string `json:"label"`
	HeartbeatUnixMs int64  `json:"heartbeat_unix_ms"`
	Tabs            []Tab  `json:"tabs"`
}

func DefaultDir() (string, error) {
	cfg, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(cfg, "AudioTabFinder"), nil
}

func EnsureDirs(base string) error {
	for _, sub := range []string{"state", "actions", "logs"} {
		if err := os.MkdirAll(filepath.Join(base, sub), 0755); err != nil {
			return fmt.Errorf("mkdir %s: %w", sub, err)
		}
	}
	return nil
}

func WriteState(dir string, p Profile) error {
	p.HeartbeatUnixMs = time.Now().UnixMilli()
	if p.Tabs == nil {
		p.Tabs = []Tab{}
	}
	final := filepath.Join(dir, "state", p.ProfileUuid+".json")
	tmp := final + ".tmp"
	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, final)
}

func ReadAllStates(dir string) ([]Profile, error) {
	entries, err := os.ReadDir(filepath.Join(dir, "state"))
	if err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	var profiles []Profile
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".json") || strings.HasSuffix(name, ".tmp") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, "state", name))
		if err != nil {
			continue
		}
		var p Profile
		if err := json.Unmarshal(data, &p); err != nil {
			continue
		}
		if now-p.HeartbeatUnixMs > HeartbeatThresholdMs {
			continue
		}
		profiles = append(profiles, p)
	}
	return profiles, nil
}
