#!/bin/bash

sudo chmod -R +x /workspaces/codecity/scripts
sudo ln -s /workspaces/codecity/scripts/* /usr/local/bin

sudo rabbitmq-plugins enable rabbitmq_management
