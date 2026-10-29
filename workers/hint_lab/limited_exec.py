"""Linux allocation limits, set BEFORE exec/import of the isolated worker.

No secrets in arguments. Fail closed if resource limits cannot be installed.
RLIMIT_DATA is NOT a cgroup/RSS reservation or a guarantee against global OOM.
"""
import os
import resource
import sys


def main():
    if len(sys.argv) < 5 or sys.argv[1] != "--kind" or sys.argv[3] != "--":
        raise SystemExit(125)
    kind = sys.argv[2]
    if kind == "lab":
        # Python/CrewAI: includes native mappings and all descendants after exec.
        limit = 2 * 1024 ** 3
        resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
    elif kind == "import":
        # V8 reserves large virtual address spaces; bound data allocations instead.
        # Linux >=4.7 applies DATA to anonymous mmap as well as brk allocations.
        limit = 3 * 1024 ** 3
        resource.setrlimit(resource.RLIMIT_DATA, (limit, limit))
    else:
        raise SystemExit(125)
    os.execvp(sys.argv[4], sys.argv[4:])


if __name__ == "__main__":
    main()
