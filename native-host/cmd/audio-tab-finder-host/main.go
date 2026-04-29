package main

import (
	"errors"
	"io"
	"os"
	"path/filepath"

	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/handler"
	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/logging"
	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/nmproto"
	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/store"
)

func main() {
	storeDir, err := store.DefaultDir()
	if err != nil {
		os.Exit(2)
	}
	if err := store.EnsureDirs(storeDir); err != nil {
		os.Exit(3)
	}

	logger, err := logging.New(filepath.Join(storeDir, "logs"))
	if err != nil {
		os.Exit(4)
	}
	defer logger.Close()
	logger.Info("native host started, pid=", os.Getpid())

	h := handler.New(storeDir, os.Stdout, logger)
	defer h.Close()

	for {
		msg, err := nmproto.Read(os.Stdin)
		if err != nil {
			if errors.Is(err, io.EOF) {
				logger.Info("stdin closed, exiting")
			} else {
				logger.Error("read failed: ", err)
			}
			return
		}
		if err := h.Dispatch(msg); err != nil {
			logger.Error("dispatch failed: ", err)
		}
	}
}
