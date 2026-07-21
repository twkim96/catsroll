# https://github.com/docker-library/ruby/blob/4ea2e7e222ba458994a266920e8815140bc2c901/3.4/alpine3.24/Dockerfile
FROM ruby:3.4-alpine

RUN apk add git linux-headers build-base

WORKDIR /battle-cats-rolls
COPY . .git

RUN git gc
RUN git reset --hard
RUN bundle config set without 'cache:test'
RUN bundle install
RUN gem install lru_redux
RUN env CC=gcc Seeker/bin/build-VampireFlower.sh
RUN chown -R nobody:nobody .

RUN apk del linux-headers build-base

USER nobody
ENTRYPOINT ["docker/entrypoint.sh"]
CMD ["bin/server"]
