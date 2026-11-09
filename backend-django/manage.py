#!/usr/bin/env python
# Django 관리 명령의 실행 진입점입니다.
import os
import sys

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
from django.core.management import execute_from_command_line

execute_from_command_line(sys.argv)
