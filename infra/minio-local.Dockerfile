FROM scratch

COPY --chmod=0755 minio /usr/bin/minio

EXPOSE 9000 9001
ENTRYPOINT ["/usr/bin/minio"]
