package nmproto

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestWriteThenRead_RoundTrip(t *testing.T) {
	var buf bytes.Buffer
	payload := []byte(`{"hello":"world"}`)

	if err := Write(&buf, payload); err != nil {
		t.Fatalf("Write failed: %v", err)
	}

	got, err := Read(&buf)
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}

	if !bytes.Equal(got, payload) {
		t.Errorf("round-trip mismatch: got %q want %q", got, payload)
	}
}

func TestWrite_LengthPrefix_LittleEndian(t *testing.T) {
	var buf bytes.Buffer
	payload := []byte("abcd") // 4 bytes
	if err := Write(&buf, payload); err != nil {
		t.Fatalf("Write failed: %v", err)
	}

	raw := buf.Bytes()
	if len(raw) != 8 {
		t.Fatalf("expected 8 bytes (4 prefix + 4 payload), got %d", len(raw))
	}

	gotLen := binary.LittleEndian.Uint32(raw[:4])
	if gotLen != 4 {
		t.Errorf("length prefix = %d, want 4", gotLen)
	}
	if string(raw[4:]) != "abcd" {
		t.Errorf("payload = %q, want abcd", raw[4:])
	}
}

func TestRead_PartialPayload_ReturnsError(t *testing.T) {
	var buf bytes.Buffer
	binary.Write(&buf, binary.LittleEndian, uint32(10)) // claim 10 bytes
	buf.WriteString("only5")                            // give 5

	_, err := Read(&buf)
	if err == nil {
		t.Fatal("expected error on truncated payload, got nil")
	}
	if !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Errorf("expected ErrUnexpectedEOF, got %v", err)
	}
}

func TestRead_OversizedMessage_RejectedBeforeAlloc(t *testing.T) {
	var buf bytes.Buffer
	binary.Write(&buf, binary.LittleEndian, uint32(MaxMessageSize+1))

	_, err := Read(&buf)
	if err == nil {
		t.Fatal("expected error on oversized message, got nil")
	}
	if !strings.Contains(err.Error(), "too large") {
		t.Errorf("expected 'too large' in error, got %v", err)
	}
}

func TestWrite_OversizedPayload_Rejected(t *testing.T) {
	var buf bytes.Buffer
	huge := make([]byte, MaxMessageSize+1)

	err := Write(&buf, huge)
	if err == nil {
		t.Fatal("expected error on oversized payload, got nil")
	}
}

func TestWriteJSON_EncodesAndFrames(t *testing.T) {
	var buf bytes.Buffer
	payload := map[string]string{"type": "hello"}

	if err := WriteJSON(&buf, payload); err != nil {
		t.Fatalf("WriteJSON failed: %v", err)
	}

	got, err := Read(&buf)
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}
	if string(got) != `{"type":"hello"}` {
		t.Errorf("got %q want %q", got, `{"type":"hello"}`)
	}
}

func TestWriteThenRead_ZeroLengthPayload(t *testing.T) {
	var buf bytes.Buffer
	if err := Write(&buf, []byte{}); err != nil {
		t.Fatalf("Write zero-length failed: %v", err)
	}
	got, err := Read(&buf)
	if err != nil {
		t.Fatalf("Read zero-length failed: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected empty slice, got %d bytes", len(got))
	}
}
