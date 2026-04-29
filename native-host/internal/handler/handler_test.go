package handler

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/nmproto"
	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/store"
)

type captureWriter struct {
	bytes.Buffer
}

func (c *captureWriter) lastMessage(t *testing.T) []byte {
	t.Helper()
	data, err := nmproto.Read(&c.Buffer)
	if err != nil {
		t.Fatalf("no message captured: %v", err)
	}
	return data
}

func newHandler(t *testing.T) (*Handler, *captureWriter, string) {
	t.Helper()
	dir := t.TempDir()
	if err := store.EnsureDirs(dir); err != nil {
		t.Fatal(err)
	}
	out := &captureWriter{}
	h := New(dir, out, nil) // logger nil = silent
	return h, out, dir
}

func TestHandleHello_RegistersProfileAndAcks(t *testing.T) {
	h, out, _ := newHandler(t)
	hello, _ := json.Marshal(nmproto.Hello{
		Type: "hello", RequestId: "r1",
		ProfileUuid: "uuid-1", Label: "Test",
	})
	if err := h.Dispatch(hello); err != nil {
		t.Fatal(err)
	}
	if h.profileUuid != "uuid-1" {
		t.Errorf("profileUuid = %q, want uuid-1", h.profileUuid)
	}
	var ack nmproto.HelloAck
	json.Unmarshal(out.lastMessage(t), &ack)
	if ack.Type != "hello_ack" || ack.RequestId != "r1" {
		t.Errorf("unexpected ack: %+v", ack)
	}
}

func TestHandleUpdateState_WritesStateFile(t *testing.T) {
	h, out, dir := newHandler(t)
	hello, _ := json.Marshal(nmproto.Hello{
		Type: "hello", RequestId: "r1",
		ProfileUuid: "uuid-1", Label: "Test",
	})
	h.Dispatch(hello)
	out.Reset()

	upd, _ := json.Marshal(nmproto.UpdateState{
		Type: "update_state", RequestId: "r2",
		Label: "Test",
		Tabs:  []store.Tab{{TabId: 1, WindowId: 1, Title: "t", Url: "u", Muted: false}},
	})
	if err := h.Dispatch(upd); err != nil {
		t.Fatal(err)
	}

	stateFile := filepath.Join(dir, "state", "uuid-1.json")
	data, err := readFile(stateFile)
	if err != nil {
		t.Fatal(err)
	}
	var p store.Profile
	json.Unmarshal(data, &p)
	if len(p.Tabs) != 1 || p.Tabs[0].TabId != 1 {
		t.Errorf("state not written correctly: %+v", p)
	}
}

func TestHandleGetAggregate_ReturnsAllFreshProfiles(t *testing.T) {
	h, out, dir := newHandler(t)
	helloRaw, _ := json.Marshal(nmproto.Hello{
		Type: "hello", RequestId: "r1",
		ProfileUuid: "self-uuid", Label: "Self",
	})
	h.Dispatch(helloRaw)
	out.Reset()

	other := store.Profile{
		SchemaVersion: 1, ProfileUuid: "other-uuid", Label: "Other",
		Tabs: []store.Tab{{TabId: 99, Title: "x"}},
	}
	store.WriteState(dir, other)

	upd, _ := json.Marshal(nmproto.UpdateState{
		Type: "update_state", RequestId: "r2", Label: "Self", Tabs: []store.Tab{},
	})
	h.Dispatch(upd)
	out.Reset()

	getAgg, _ := json.Marshal(nmproto.GetAggregate{Type: "get_aggregate", RequestId: "r3"})
	h.Dispatch(getAgg)

	var agg nmproto.Aggregate
	json.Unmarshal(out.lastMessage(t), &agg)
	if agg.Type != "aggregate" || agg.RequestId != "r3" {
		t.Errorf("unexpected response: %+v", agg)
	}
	if len(agg.Profiles) != 2 {
		t.Errorf("expected 2 profiles, got %d", len(agg.Profiles))
	}
	var sawSelf, sawOther bool
	for _, p := range agg.Profiles {
		if p.ProfileUuid == "self-uuid" && p.IsSelf {
			sawSelf = true
		}
		if p.ProfileUuid == "other-uuid" && !p.IsSelf {
			sawOther = true
		}
	}
	if !sawSelf || !sawOther {
		t.Errorf("missing profiles: self=%v other=%v", sawSelf, sawOther)
	}
}

func TestHandleSendAction_CreatesActionFileAndAcks(t *testing.T) {
	h, out, dir := newHandler(t)
	helloRaw, _ := json.Marshal(nmproto.Hello{
		Type: "hello", RequestId: "r1",
		ProfileUuid: "src-uuid", Label: "Source",
	})
	h.Dispatch(helloRaw)
	out.Reset()

	send, _ := json.Marshal(nmproto.SendAction{
		Type: "send_action", RequestId: "r2",
		TargetProfileUuid: "tgt-uuid",
		Action:            "mute",
		TargetTabId:       42, TargetWindowId: 7,
	})
	if err := h.Dispatch(send); err != nil {
		t.Fatal(err)
	}

	var ack nmproto.SendActionAck
	json.Unmarshal(out.lastMessage(t), &ack)
	if ack.Type != "send_action_ack" || ack.ActionId == "" {
		t.Errorf("unexpected ack: %+v", ack)
	}

	files, _ := readDir(filepath.Join(dir, "actions"))
	if len(files) != 1 {
		t.Errorf("expected 1 action file, got %d", len(files))
	}
}

func TestHandleSendAction_RejectsSelfTarget(t *testing.T) {
	h, out, _ := newHandler(t)
	helloRaw, _ := json.Marshal(nmproto.Hello{
		Type: "hello", RequestId: "r1",
		ProfileUuid: "uuid", Label: "X",
	})
	h.Dispatch(helloRaw)
	out.Reset()

	send, _ := json.Marshal(nmproto.SendAction{
		Type: "send_action", RequestId: "r2",
		TargetProfileUuid: "uuid",
		Action:            "mute", TargetTabId: 1,
	})
	h.Dispatch(send)

	var errMsg nmproto.ErrorMsg
	json.Unmarshal(out.lastMessage(t), &errMsg)
	if errMsg.Type != "error" || errMsg.Code != "SELF_TARGET" {
		t.Errorf("expected SELF_TARGET error, got %+v", errMsg)
	}
}

func TestHandleActionResult_DeletesActionFile(t *testing.T) {
	h, out, dir := newHandler(t)
	helloRaw, _ := json.Marshal(nmproto.Hello{
		Type: "hello", RequestId: "r1",
		ProfileUuid: "tgt-uuid", Label: "T",
	})
	h.Dispatch(helloRaw)
	out.Reset()

	a := store.Action{
		SchemaVersion: 1, ActionId: "to-delete",
		SourceProfileUuid: "src", TargetProfileUuid: "tgt-uuid",
		Action: "mute", TargetTabId: 1,
		CreatedAtUnixMs: time.Now().UnixMilli(), TtlMs: 5000,
	}
	store.WriteAction(dir, a)

	res, _ := json.Marshal(nmproto.ActionResult{
		Type: "action_result", ActionId: "to-delete", Success: true,
	})
	h.Dispatch(res)

	path := filepath.Join(dir, "actions", "to-delete.json")
	if _, err := readFile(path); err == nil {
		t.Errorf("expected action file deleted")
	}
}

func TestHandleUnknownType_ReturnsError(t *testing.T) {
	h, out, _ := newHandler(t)
	raw := []byte(`{"type":"bogus","request_id":"r1"}`)
	h.Dispatch(raw)

	var errMsg nmproto.ErrorMsg
	json.Unmarshal(out.lastMessage(t), &errMsg)
	if errMsg.Type != "error" || errMsg.Code != "UNKNOWN_TYPE" {
		t.Errorf("expected UNKNOWN_TYPE error, got %+v", errMsg)
	}
}

// helpers
func readFile(path string) ([]byte, error) {
	return os.ReadFile(path)
}

func readDir(path string) ([]string, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		out = append(out, e.Name())
	}
	return out, nil
}
