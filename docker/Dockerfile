# https://github.com/docker-library/ruby/blob/4ea2e7e222ba458994a266920e8815140bc2c901/3.4/alpine3.24/Dockerfile
FROM ruby:3.4-alpine

WORKDIR /battle-cats-rolls
RUN apk add --no-cache git
RUN --mount=type=bind,target=/host.git,readonly \
  git config --global uploadpack.allowfilter true; \
  git clone --single-branch --filter=blob:none --no-local /host.git .; \
  git gc

RUN set -eux; \
  apk add --no-cache linux-headers build-base; \
  bundle config set without 'cache:test'; \
  bundle install; \
  gem install lru_redux; \
  env CC=gcc Seeker/bin/build-VampireFlower.sh; \
  chown -R nobody:nobody .; \
  apk del linux-headers build-base

USER nobody
ENTRYPOINT ["docker/entrypoint.sh"]
CMD ["bin/server"]
