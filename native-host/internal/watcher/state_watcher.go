package watcher

import (
	"strings"

	"github.com/fsnotify/fsnotify"
)

type StateWatcher struct {
	dir      string
	onChange func()
	fsw      *fsnotify.Watcher
	done     chan struct{}
}

func NewStateWatcher(stateDir string, onChange func()) (*StateWatcher, error) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	if err := fsw.Add(stateDir); err != nil {
		fsw.Close()
		return nil, err
	}
	w := &StateWatcher{
		dir:      stateDir,
		onChange: onChange,
		fsw:      fsw,
		done:     make(chan struct{}),
	}
	go w.loop()
	return w, nil
}

func (w *StateWatcher) Close() error {
	close(w.done)
	return w.fsw.Close()
}

func (w *StateWatcher) loop() {
	for {
		select {
		case <-w.done:
			return
		case ev, ok := <-w.fsw.Events:
			if !ok {
				return
			}
			if ev.Op&(fsnotify.Create|fsnotify.Write) == 0 {
				continue
			}
			if !strings.HasSuffix(ev.Name, ".json") || strings.HasSuffix(ev.Name, ".tmp") {
				continue
			}
			w.onChange()
		case <-w.fsw.Errors:
			// swallow
		}
	}
}
