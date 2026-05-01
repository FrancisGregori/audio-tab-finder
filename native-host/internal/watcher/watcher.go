package watcher

import (
	"os"
	"strings"

	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/store"
	"github.com/fsnotify/fsnotify"
)

type Watcher struct {
	dir        string
	targetUuid string
	onAction   func(store.Action)
	fsw        *fsnotify.Watcher
	done       chan struct{}
}

func New(actionsDir, profileUuid string, onAction func(store.Action)) (*Watcher, error) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	if err := fsw.Add(actionsDir); err != nil {
		fsw.Close()
		return nil, err
	}
	w := &Watcher{
		dir:        actionsDir,
		targetUuid: profileUuid,
		onAction:   onAction,
		fsw:        fsw,
		done:       make(chan struct{}),
	}
	go w.loop()
	return w, nil
}

func (w *Watcher) Close() error {
	close(w.done)
	return w.fsw.Close()
}

func (w *Watcher) loop() {
	for {
		select {
		case <-w.done:
			return
		case ev, ok := <-w.fsw.Events:
			if !ok {
				return
			}
			w.handleEvent(ev)
		case <-w.fsw.Errors:
			// swallow individual errors, keep watching
		}
	}
}

func (w *Watcher) handleEvent(ev fsnotify.Event) {
	if ev.Op&fsnotify.Create != fsnotify.Create {
		return
	}
	name := ev.Name
	if !strings.HasSuffix(name, ".json") || strings.HasSuffix(name, ".tmp") {
		return
	}
	a, err := store.ReadAction(name)
	if err != nil {
		return
	}
	if a.TargetProfileUuid != w.targetUuid {
		return
	}
	if a.Expired() {
		os.Remove(name)
		return
	}
	w.onAction(a)
}
