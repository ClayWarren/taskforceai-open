package main

import (
	"sync"
)

func main() {
	shutdownGroup := &sync.WaitGroup{}
	runServer(shutdownGroup)
}
