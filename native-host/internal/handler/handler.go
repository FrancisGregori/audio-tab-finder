package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"sync"
	"time"

	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/logging"
	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/nmproto"
	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/store"
	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/watcher"
	"github.com/google/uuid"
)

const HostVersion = "0.1.0"
const DefaultActionTtlMs = 5000

type Handler struct {
	storeDir     string
	profileUuid  string
	label        string
	out          io.Writer
	logger       *logging.Logger
	watcher      *watcher.Watcher
	stateWatcher *watcher.StateWatcher
	mu           sync.Mutex
	outMu        sync.Mutex
}

func New(storeDir string, out io.Writer, logger *logging.Logger) *Handler {
	return &Handler{
		storeDir: storeDir,
		out:      out,
		logger:   logger,
	}
}

func (h *Handler) writeJSON(v any) error {
	h.outMu.Lock()
	defer h.outMu.Unlock()
	return nmproto.WriteJSON(h.out, v)
}

func (h *Handler) Close() {
	if h.watcher != nil {
		h.watcher.Close()
	}
	if h.stateWatcher != nil {
		h.stateWatcher.Close()
	}
}

func (h *Handler) Dispatch(raw []byte) error {
	var base struct {
		Type      string `json:"type"`
		RequestId string `json:"request_id"`
	}
	if err := json.Unmarshal(raw, &base); err != nil {
		return h.replyError("", "BAD_JSON", err.Error())
	}
	switch base.Type {
	case "hello":
		return h.handleHello(raw)
	case "update_state":
		return h.handleUpdateState(raw)
	case "get_aggregate":
		return h.handleGetAggregate(raw)
	case "send_action":
		return h.handleSendAction(raw)
	case "action_result":
		return h.handleActionResult(raw)
	default:
		return h.replyError(base.RequestId, "UNKNOWN_TYPE", "unknown message type: "+base.Type)
	}
}

func (h *Handler) handleHello(raw []byte) error {
	var msg nmproto.Hello
	if err := json.Unmarshal(raw, &msg); err != nil {
		return h.replyError("", "BAD_JSON", err.Error())
	}
	h.mu.Lock()
	h.profileUuid = msg.ProfileUuid
	h.label = msg.Label
	h.mu.Unlock()

	if err := h.startWatcher(); err != nil {
		return h.replyError(msg.RequestId, "WATCHER_FAIL", err.Error())
	}
	return h.writeJSON(nmproto.HelloAck{
		Type: "hello_ack", RequestId: msg.RequestId, HostVersion: HostVersion,
	})
}

func (h *Handler) startWatcher() error {
	if h.watcher != nil {
		return nil
	}
	w, err := watcher.New(
		filepath.Join(h.storeDir, "actions"),
		h.profileUuid,
		h.onActionPushed,
	)
	if err != nil {
		return err
	}
	h.watcher = w

	sw, err := watcher.NewStateWatcher(
		filepath.Join(h.storeDir, "state"),
		h.onStateChanged,
	)
	if err != nil {
		w.Close()
		h.watcher = nil
		return err
	}
	h.stateWatcher = sw
	return nil
}

func (h *Handler) onStateChanged() {
	profiles, err := store.ReadAllStates(h.storeDir)
	if err != nil {
		return
	}
	h.mu.Lock()
	selfUuid := h.profileUuid
	h.mu.Unlock()
	out := make([]nmproto.AggregateProfile, 0, len(profiles))
	for _, p := range profiles {
		out = append(out, nmproto.AggregateProfile{
			ProfileUuid: p.ProfileUuid,
			Label:       p.Label,
			IsSelf:      p.ProfileUuid == selfUuid,
			Tabs:        p.Tabs,
		})
	}
	_ = h.writeJSON(nmproto.StateChanged{
		Type:     "state_changed",
		Profiles: out,
	})
}

func (h *Handler) onActionPushed(a store.Action) {
	_ = h.writeJSON(nmproto.ActionRequest{
		Type:              "action_request",
		ActionId:          a.ActionId,
		SourceProfileUuid: a.SourceProfileUuid,
		Action:            a.Action,
		TargetTabId:       a.TargetTabId,
		TargetWindowId:    a.TargetWindowId,
	})
}

func (h *Handler) handleUpdateState(raw []byte) error {
	var msg nmproto.UpdateState
	if err := json.Unmarshal(raw, &msg); err != nil {
		return h.replyError("", "BAD_JSON", err.Error())
	}
	h.mu.Lock()
	h.label = msg.Label
	profileUuid := h.profileUuid
	h.mu.Unlock()
	if profileUuid == "" {
		return h.replyError(msg.RequestId, "NO_HELLO", "must send hello first")
	}
	p := store.Profile{
		SchemaVersion: 1,
		ProfileUuid:   profileUuid,
		Label:         msg.Label,
		Tabs:          msg.Tabs,
	}
	if err := store.WriteState(h.storeDir, p); err != nil {
		return h.replyError(msg.RequestId, "WRITE_FAILED", err.Error())
	}
	return h.writeJSON(nmproto.UpdateStateAck{
		Type: "update_state_ack", RequestId: msg.RequestId,
	})
}

func (h *Handler) handleGetAggregate(raw []byte) error {
	var msg nmproto.GetAggregate
	if err := json.Unmarshal(raw, &msg); err != nil {
		return h.replyError("", "BAD_JSON", err.Error())
	}
	h.mu.Lock()
	selfUuid := h.profileUuid
	h.mu.Unlock()
	profiles, err := store.ReadAllStates(h.storeDir)
	if err != nil {
		return h.replyError(msg.RequestId, "READ_FAILED", err.Error())
	}
	out := make([]nmproto.AggregateProfile, 0, len(profiles))
	for _, p := range profiles {
		out = append(out, nmproto.AggregateProfile{
			ProfileUuid: p.ProfileUuid,
			Label:       p.Label,
			IsSelf:      p.ProfileUuid == selfUuid,
			Tabs:        p.Tabs,
		})
	}
	return h.writeJSON(nmproto.Aggregate{
		Type: "aggregate", RequestId: msg.RequestId, Profiles: out,
	})
}

func (h *Handler) handleSendAction(raw []byte) error {
	var msg nmproto.SendAction
	if err := json.Unmarshal(raw, &msg); err != nil {
		return h.replyError("", "BAD_JSON", err.Error())
	}
	h.mu.Lock()
	selfUuid := h.profileUuid
	h.mu.Unlock()
	if msg.TargetProfileUuid == selfUuid {
		return h.replyError(msg.RequestId, "SELF_TARGET", "cannot target self")
	}
	a := store.Action{
		SchemaVersion:     1,
		ActionId:          uuid.NewString(),
		SourceProfileUuid: selfUuid,
		TargetProfileUuid: msg.TargetProfileUuid,
		Action:            msg.Action,
		TargetTabId:       msg.TargetTabId,
		TargetWindowId:    msg.TargetWindowId,
		CreatedAtUnixMs:   time.Now().UnixMilli(),
		TtlMs:             DefaultActionTtlMs,
	}
	if err := store.WriteAction(h.storeDir, a); err != nil {
		return h.replyError(msg.RequestId, "WRITE_FAILED", err.Error())
	}
	return h.writeJSON(nmproto.SendActionAck{
		Type: "send_action_ack", RequestId: msg.RequestId, ActionId: a.ActionId,
	})
}

func (h *Handler) handleActionResult(raw []byte) error {
	var msg nmproto.ActionResult
	if err := json.Unmarshal(raw, &msg); err != nil {
		return h.replyError("", "BAD_JSON", err.Error())
	}
	path := filepath.Join(h.storeDir, "actions", msg.ActionId+".json")
	return store.DeleteActionFile(path)
}

func (h *Handler) replyError(requestId, code, message string) error {
	return h.writeJSON(nmproto.ErrorMsg{
		Type: "error", RequestId: requestId, Code: code, Message: message,
	})
}

func (h *Handler) logf(format string, args ...any) {
	if h.logger == nil {
		return
	}
	h.logger.Info(fmt.Sprintf(format, args...))
}
