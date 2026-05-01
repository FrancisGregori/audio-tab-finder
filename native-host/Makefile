.PHONY: build install uninstall test clean

BINARY := bin/audio-tab-finder-host
INSTALL_DIR := $(HOME)/Library/Application Support/AudioTabFinder/bin
NM_MANIFEST_DIR := $(HOME)/Library/Application Support/Google/Chrome/NativeMessagingHosts
NM_NAME := com.fgregori.audio_tab_finder

build:
	mkdir -p bin
	go build -o $(BINARY) ./cmd/audio-tab-finder-host

install: build
	@if [ -z "$(EXT_ID)" ]; then echo "Usage: make install EXT_ID=<extension-id>"; exit 1; fi
	mkdir -p "$(INSTALL_DIR)"
	cp $(BINARY) "$(INSTALL_DIR)/audio-tab-finder-host"
	xattr -c "$(INSTALL_DIR)/audio-tab-finder-host" 2>/dev/null || true
	mkdir -p "$(NM_MANIFEST_DIR)"
	sed -e 's|{{HOST_BINARY_PATH}}|$(INSTALL_DIR)/audio-tab-finder-host|g' \
	    -e 's|{{EXTENSION_ID}}|$(EXT_ID)|g' \
	    manifest/com.fgregori.audio_tab_finder.json.tmpl \
	  > "$(NM_MANIFEST_DIR)/$(NM_NAME).json"
	@echo "Installed to $(INSTALL_DIR). Reload extension to connect."

uninstall:
	rm -f "$(INSTALL_DIR)/audio-tab-finder-host"
	rm -f "$(NM_MANIFEST_DIR)/$(NM_NAME).json"

test:
	go test ./...

clean:
	rm -rf bin
