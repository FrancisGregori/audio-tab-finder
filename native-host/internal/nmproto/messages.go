package nmproto

import "github.com/FrancisGregori/audio-tab-finder/native-host/internal/store"

// Incoming (extension -> host)

type Hello struct {
	Type        string `json:"type"`
	RequestId   string `json:"request_id"`
	ProfileUuid string `json:"profile_uuid"`
	Label       string `json:"label"`
}

type UpdateState struct {
	Type      string      `json:"type"`
	RequestId string      `json:"request_id"`
	Label     string      `json:"label"`
	Tabs      []store.Tab `json:"tabs"`
}

type GetAggregate struct {
	Type      string `json:"type"`
	RequestId string `json:"request_id"`
}

type SendAction struct {
	Type              string `json:"type"`
	RequestId         string `json:"request_id"`
	TargetProfileUuid string `json:"target_profile_uuid"`
	Action            string `json:"action"`
	TargetTabId       int    `json:"target_tab_id"`
	TargetWindowId    int    `json:"target_window_id"`
}

type ActionResult struct {
	Type     string `json:"type"`
	ActionId string `json:"action_id"`
	Success  bool   `json:"success"`
	Error    string `json:"error,omitempty"`
}

// Outgoing (host -> extension)

type HelloAck struct {
	Type        string `json:"type"`
	RequestId   string `json:"request_id"`
	HostVersion string `json:"host_version"`
}

type UpdateStateAck struct {
	Type      string `json:"type"`
	RequestId string `json:"request_id"`
}

type AggregateProfile struct {
	ProfileUuid string      `json:"profile_uuid"`
	Label       string      `json:"label"`
	IsSelf      bool        `json:"is_self"`
	Tabs        []store.Tab `json:"tabs"`
}

type Aggregate struct {
	Type      string             `json:"type"`
	RequestId string             `json:"request_id"`
	Profiles  []AggregateProfile `json:"profiles"`
}

type SendActionAck struct {
	Type      string `json:"type"`
	RequestId string `json:"request_id"`
	ActionId  string `json:"action_id"`
}

type ActionRequest struct {
	Type              string `json:"type"`
	ActionId          string `json:"action_id"`
	SourceProfileUuid string `json:"source_profile_uuid"`
	Action            string `json:"action"`
	TargetTabId       int    `json:"target_tab_id"`
	TargetWindowId    int    `json:"target_window_id"`
}

type ErrorMsg struct {
	Type      string `json:"type"`
	RequestId string `json:"request_id"`
	Code      string `json:"code"`
	Message   string `json:"message"`
}

type StateChanged struct {
	Type     string             `json:"type"`
	Profiles []AggregateProfile `json:"profiles"`
}
