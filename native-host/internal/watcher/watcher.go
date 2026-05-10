package watcher

import (
	"os"
	"strings"
	"time"

	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/store"
	"github.com/fsnotify/fsnotify"
)

// readActionWithRetry reads an action file, retrying on transient errors.
// On Windows, ReadDirectoryChangesW can fire a Create event before the file
// is fully readable (file system flush, antivirus scan briefly locks the
// file, etc.). Without retry, those actions are silently lost — which the
// user sees as cross-profile mute/navigate/close that "sometimes" doesn't
// fire. Five attempts × 30ms = up to 150ms total wait, which is well below
// the 5s action TTL and imperceptible to the user.
func readActionWithRetry(path string) (store.Action, error) {
	var (
		a   store.Action
		err error
	)
	for i := 0; i < 5; i++ {
		a, err = store.ReadAction(path)
		if err == nil {
			return a, nil
		}
		time.Sleep(30 * time.Millisecond)
	}
	return a, err
}

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
	a, err := readActionWithRetry(name)
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
